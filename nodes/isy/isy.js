var restler = require('restler');
var xmldoc = require('xmldoc');
var WebSocket = require('faye-websocket');
const leftPad = require('left-pad');
var EventEmitter = require('events');
var ISYNode = require('./isy-node.js');
var ISYScene = require('./isy-scene.js');
var ISYProgram = require('./isy-program.js');
var ISYVariable = require('./isy-variable.js');
let uom = require('./uom.json');
let controls = require('./controls.json');

var ISY = function (controller_node, address, username, password, useHttps) {
    this.node = controller_node;
    this.node.log('Creating ISY Controller Object with IP address of ' + address.toString() + ', https =' + useHttps.toString());
    this.address = address;
    this.protocol = (useHttps == true) ? 'https' : 'http';
    this.userName = username;
    this.password = password;
    this.options = {
        username: this.userName,
        password: this.password
    };

    this.uom = uom;
    this.controls = controls;

    this.nodeFolders = {};
    this.devices = {};
    this.scenes = {};
    this.variables = {};
    this.programs = {};

    this.watchdogTimer = null;

    this.events = new EventEmitter.EventEmitter();

    this.connected = false;

    this.initialized = {
        config: false,
        nodeFolders: false,
        nodes: false,
        scenes : false,
        programs : false,
        int_variables : false,
        state_variables : false
    };

    this.ISYVersion = '';
    this.nodeServersSupported = 0;
    this.nodeServerNumber = 0;
    this.hasWeather = false;

    this.initialize = function () {

        try {
            this.node.log('Starting initialization of ISY at ' + this.address.toString());

            this.getISYConfig(); //basic controller info (version, node server support, modules installed, etc...)
            this.getNodesAndScenes();
            this.getPrograms();
            this.getVariables(1); //integer variables
            this.getVariables(2); //state variables

        } catch (err) {
            return;
        }
    }

    this.events.on('item_init_complete', function (isy) {
        if (isy.initialized.config && isy.initialized.nodeFolders && isy.initialized.nodes && isy.initialized.scenes && isy.initialized.programs && isy.initialized.int_variables && isy.initialized.state_variables && !isy.connected) {
            isy.initializeWebSocket();
            isy.watchdogTimer = setInterval(isy.websocketWatchdog.bind(isy), 60000);
        }
    });

    this.initializeWebSocket = function () {
        var isy = this;
        try {
            var auth = 'Basic ' + new Buffer(this.userName + ':' + this.password).toString('base64');
            var protocol = (isy.protocol == 'https') ? 'wss' : 'ws';
            var url = protocol + '://' + isy.address + '/rest/subscribe';
            isy.node.log('Initializing web socket with ' + isy.address.toString() + ', url=' + url);

            this.webSocket = new WebSocket.Client(url,
                ["ISYSUB"],
                {
                    headers: {
                        "Origin": "com.universal-devices.websockets.isy",
                        "Authorization": auth
                    }
                }
            );

            isy.lastActivity = new Date();
        } catch (err) {
            isy.node.warn('Error establishing web socket: ' + err);
        }
        this.webSocket.on('open', function (event) {
            isy.node.log('Websocket established with ISY at ' + isy.address.toString());
            isy.connected = true;
            isy.events.emit('initialized'); //inform clients that ISY connection has been initialized
        });
        this.webSocket.on('message', function (event) {
            isy.connected = true;
            isy.handleWebSocketMessage(event);
        });
        this.webSocket.on('close', function (event) {
            isy.node.log('Websocket connection to ISY at ' + isy.address.toString() + ' CLOSED.  Will re-try in 2 seconds');
            isy.connected = false;
            isy.events.emit('websocket_closed');
            isy.webSocket = null;
            isy.wsTimeout = setTimeout(function () { isy.initializeWebSocket() }, 2000);
        })
    }

    this.closeWebSocket = function () {
        try {
            this.node.log('Closing ISY webSocket connection');
            this.webSocket.close();
            this.webSocket = null;
        } catch (err) {
            this.node.warn('Error closing ISY websocket: ' + err);
        }
    }

    this.websocketWatchdog = function () {
        try {
            this.node.trace('WebsocketWatchdog for ' + this.address.toString());
            var timeNow = new Date();
            if ((timeNow - this.lastActivity) > 60000) {
                this.connected = false;
                this.events.emit('connection-timeout');
                this.node.log('No activity detected on ISY websocket for one minute. Reinitializing web sockets');
                this.initializeWebSocket();
            }
        } catch (err) {
            this.node.warn('Error processing websocketWatchdog: ' + err);
        }
    }

    this.handleWebSocketMessage = function (event) {
        try {
            this.lastActivity = new Date();
            var document = new xmldoc.XmlDocument(event.data); //parse websocket message as XML
            var event_type = '';
            var action_type = '';

            //Parse websocket message and update appropriate node, scene, variable, or program:
            //this.node.trace('Parsing websocket message from ISY: ' + document.toString());
            try {
                //Initial message from websocket cannot be parsed as below.  Detect it and exit, if necessary
                if (document.childNamed('SID')) {
                    return;
                }
            } catch (err) {
                //do nothing
            }
            var controlElement = document.childNamed('control').val; //event type (usually)
            var actionValue = document.childNamed('action').val; //event sub-type (usually)
            var address = document.childNamed('node').val; //seems to only be populated for changes to node properties
            var eventInfo = document.childNamed('eventInfo');  //contents of eventInfo vary based on event type

            if (controlElement == '_0') { //Heartbeat event
                //this.node.trace('Heartbeat received from ISY');
                event_type = 'heartbeat';
            } else if (controlElement == '_1') { //trigger event
                event_type = 'trigger';
                if (actionValue == 0) {  //program event
                    action_type = 'event_status';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var isProgramEvent = false;
                    try {
                        if (eventInfo.childNamed('s') !== undefined) {//program events can be provided with only 'id' and 'nsr' elements.
                            isProgramEvent = true;
                        }
                    }catch(err) {
                            isProgramEvent = false;
                        }
                    if (isProgramEvent) {
                        var programId = leftPad(eventInfo.childNamed('id').val, 4, '0'); //program Id defined by REST is 4 digits but event return only Hex representation with no leading zeros.
                        try {
                            var thisProgram = this.programs[programId];
                            thisProgram.websocketStatus(eventInfo);
                        } catch (err) {
                            this.node.debug('Websocket processing Error: Program not found: ' + programId.toString() + ' Error description: ' + err);
                        }
                    }
                } else if (actionValue == 1) {
                    action_type = 'get_status';
                } else if (actionValue == 2) {
                    action_type = 'key_changed';
                } else if (actionValue == 3) {
                    action_type = 'info_string';
                    //this event seems to be preceeded by an event with the node's property that was changed as the control field.  Since parsing both events would result in duplicate events here, we'll stick with the other one, which is formatted better
                } else if (actionValue == 4) {
                    action_type = 'ir_learn_mode';
                } else if (actionValue == 5) {
                    action_type = 'schedule';
                } else if (actionValue == 6) {
                    action_type = 'variable_status';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var varXml = eventInfo.childNamed('var');
                    var variableId = varXml.attr.type + '_' + varXml.attr.id;
                    var thisVariable = this.variables[variableId];
                    thisVariable.updatedVal(varXml);
                } else if (actionValue == 7) {
                    action_type = 'variable_initialized';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var varXml = eventInfo.childNamed('var');
                    var variableId = varXml.attr.type + '_' + varXml.attr.id;
                    var thisVariable = this.variables[variableId];
                    thisVariable.updatedInit(varXml);
                } else if (actionValue == 8) {
                    action_type = 'key';
                } else {
                    action_type = 'other';
                }

            } else if (controlElement == '_2') { //driver-specific event
                event_type = 'driver_specific';
            } else if (controlElement == '_3') { //node changed
                event_type = 'node_changed';
                if (actionValue == 'NN') {
                    action_type = 'node_renamed';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var thisNode = this.devices[address];
                    var newName = eventInfo.childNamed('newName').val;
                    thisNode.updatedName(newName);
                } else if (actionValue == 'NR') {
                    action_type = 'node_removed';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    this.node.trace('Removing node ' + address);
                    delete this.devices[address];
                } else if (actionValue == 'MV') {
                    action_type = 'node_added_to_scene';
                    var movedNode = eventInfo.childNamed('movedNode');
                    this.node.trace('Adding node ' + movedNode + ' to scene ' + address);
                    var updatedScene = this.scenes[address];
                    updatedScene.addedNode(movedNode);
                } else if (actionValue == 'CL') {
                    action_type = 'scene_link_changed';
                } else if (actionValue == 'RG') {
                    action_type = 'node_removed_from_scene';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var removedNode = eventInfo.childNamed('removedNode');
                    this.node.trace('Removed node ' + removedNode + ' from scene ' + address);
                    var updatedScene = this.scenes[address];
                    updatedScene.removedNode(removedNode);
                } else if (actionValue == 'EN') {
                    var enable_disable = eventInfo('enabled');
                    action_type = 'node_' + enable_disable + 'd';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    if (address in this.devices) {
                        var updatedNode = this.devices[address];
                        updatedNode.enabledDisabled(enable_disable);
                    } else if (address in this.scenes) {
                        var updatedScene = this.scenes[address];
                        updatedScene.enabledDisabled(enable_disable);
                    } else {
                        this.node.warn('Node ' + address + 'set to ' + enable_disable.toString() + ' but node not added locally');
                    }
                } else if (actionValue == 'PC') {
                    action_type = 'parent_changed';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var nodeType = eventInfo.childNamed('nodeType');
                    var parent = eventInfo.childNamed('parent').val;
                    var parentType = eventInfo.childNamed('parentType').val;
                    this.node.trace('Updating parent of ' + address + ' to ' + parent);

                    if (nodeType == 1) { //Node is a device
                        var nodeUpdated = this.devices[address];
                        nodeUpdated.updatedParent(parent, parentType);
                    } else if (nodeType == 2) { //Node is a scene (group)
                        var sceneUpdated = this.scenes[address];
                        sceneUpdated.updatedParent(parent, parentType);
                    }
                    // nodeType of 3 is folder, not yet implemented here
                } else if (actionValue == 'PI') {
                    action_type = 'power_info_changed';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var wattage = eventInfo.childNamed('wattage');
                    this.node.trace('Updating ' + address + ' wattage to ' + wattage);
                    var updatedNode = this.devices[address];
                    updatedNode.updatedWattage(wattage);
                } else if (actionValue == 'GN') {
                    action_type = 'scene_renamed';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    var newName = eventInfo.childNamed('newName');
                    var updatedScene = this.scenes[address];
                    this.node.trace('Renaming ' + address + ' from ' + updatedScene.name + ' to ' + newName);
                    updatedScene.updatedName(newName);
                } else if (actionValue == 'GR') {
                    action_type = 'scene_removed';
                    //this.node.trace(event_type + ', ' + action_type + ' received from ISY');
                    this.node.trace('Removing scene ' + address);
                    delete this.scenes[address];
                } else if (actionValue == 'GD') {
                    action_type = 'scene_added';
                    //TODO: Add new scene locally
                } else if (actionValue == 'NE') {
                    action_type = 'node_error';
                } else if (actionValue == 'CE') {
                    action_type = 'node_error_clear';
                } else if (actionValue == 'SN') {
                    action_type = 'discovering_nodes';
                } else if (actionValue == 'SC') {
                    action_type = 'discovery_complete';
                } else if (actionValue == 'WR') {
                    action_type = 'network_renamed';
                } else if (actionValue == 'WH') {
                    action_type = 'pending_device_operation';
                } else if (actionValue == 'WD') {
                    action_type = 'programming_device';
                } else if (actionValue == 'RV') {
                    action_type = 'node_revised';
                }
            } else if (controlElement == '_4') { //system configuration update event
                event_type = 'system_configuration';
                if (actionValue == '0') {
                    action_type = 'time_changed';
                } else if (actionValue == '1') {
                    action_type = 'time_config_changed';
                } else if (actionValue == '2') {
                    action_type = 'ntp_settings_updated';
                } else if (actionValue == '3') {
                    action_type = 'notification_settings_updated';
                } else if (actionValue == '4') {
                    action_type = 'ntp_comm_error';
                } else if (actionValue == '5') {
                    action_type = 'batch_mode_updated';
                } else if (actionValue == '6') {
                    action_type = 'battery_mode_prog_updated';
                }
            } else if (controlElement == '_5') { //system status update event
                event_type = 'system_status';
                if (actionValue == '0') {
                    action_type = 'system_status_not_busy';
                } else if (actionValue == '1') {
                    action_type = 'system_status_busy';
                } else if (actionValue == '2') {
                    action_type = 'idle';
                } else if (actionValue == '3') {
                    action_type = 'safe_mode';
                }
            } else if (controlElement == '_6') { //internet status update event
                event_type = 'internet_status';
            } else if (controlElement == '_7') { //progress report event
                event_type = 'progress_report';
            } else if (controlElement == '_8') { //security system event
                event_type = 'security_system';
                if (actionValue == '0') {
                    action_type = 'security_disconnected';
                } else if (actionValue == '1') {
                    action_type = 'security_connected';
                } else if (actionValue == 'DA') {
                    action_type = 'security_disarmed';
                } else if (actionValue == 'AW') {
                    action_type = 'security_armed_away';
                } else if (actionValue == 'AS') {
                    action_type = 'security_armed_stay';
                } else if (actionValue == 'ASI') {
                    action_type = 'security_armed_stay_instant';
                } else if (actionValue == 'AN') {
                    action_type = 'security_armed_night';
                } else if (actionValue == 'ANI') {
                    action_type = 'security_armed_night_instant';
                } else if (actionValue == 'AV') {
                    action_type = 'security_armed_vacation';
                }
            } else if (controlElement == '_9') { //system alert event 
                event_type = 'system_alert';
            } else if (controlElement == '_10') { //OpenADR and Flex your power events
                event_type = 'openadr';
            } else if (controlElement == '_11') { //climate event
                event_type = 'climate';
            } else if (controlElement == '_12') { //AMI/SEP event, Energy Management
                event_type = 'ami_sep_energy';
            } else if (controlElement == '_13') { //External energy monitoring event
                event_type = 'external_energy';
            } else if (controlElement == '_14') { //UPB Linker Event
                event_type = 'upb_linker';
            } else if (controlElement == '_15') { //UPB Device Adder State
                event_type = 'upb_device_add';
            } else if (controlElement == '_16') { //UPB Device Status Event
                event_type = 'upb_device_status';
            } else if (controlElement == '_17') { //Gas Meter Event
                event_type = 'gas_meter';
            } else if (controlElement == '_18') { //Zigbee Event
                event_type = 'zigbee';
            } else if (controlElement == '_19') { //ELK Event
                event_type = 'elk';
                //TODO: Add more integrated support for ELK devices if there's demand from the user community
            } else if (controlElement == '_20') { //Device Linker Event
                event_type = 'device_link';
            } else if (controlElement == '_21') { //Z-Wave Event
                event_type = 'z_wave';
            } else if (controlElement == '_22') { //Billing Event
                event_type = 'billing';
            } else if (controlElement == '_23') { //Portal Event
                event_type = 'portal';
            } else { //other control elements could be controls on nodes directly i.e. GV2, ST, etc...
                //this.node.trace('Control element update received from ISY');
                if (action_type != 'ERR') {
                    var uom = document.childNamed('action').attr.uom || '';
                    var prec = document.childNamed('action').attr.prec || '';
                    try {
                        //message do not always have fmtAct element
                        var formatted = document.childNamed('fmtAct').val;
                    } catch (err) {
                        var formatted = action_type;
                    }
                    try {
                        var changedNode = this.devices[address];
                        var value = actionValue;
                        changedNode.updatedProperty(controlElement, value, formatted, uom);
                    } catch (err) {
                        this.node.debug('Not able to update device property: ' + err);
                    }
                    
                }
            }
        } catch (err) {
            this.node.warn('Error parsing ISY websocket message: ' + err);
        }

        try {
            this.events.emit('websocket_event', event_type, action_type, document);  //Allow client to receive raw websocket
        } catch (err) {
            this.node.warn('Error sending raw websocket message:' + err);
        }

    }

    this.checkForFailure = function (response) {
        return (response == null || response instanceof Error || response.statusCode != 200);
    }

    this.getISYConfig = function () {
        this.node.log('Retrieving ISY configuration from ' + this.address.toString());
        var isy = this;
        //Parse known nodes and scenes:
        restler.get(this.protocol + '://' + this.address + '/rest/config', this.options).on('complete', function (result, response) {
            try {
                if (isy.checkForFailure(response)) {
                    isy.node.error("Unable to contact the ISY to get the configuration: " + result.message);
                }
                else {
                    var document = new xmldoc.XmlDocument(result);

                    //Get ISY version number and check whether it supports node servers:
                    try {
                        isy.ISYVersion = document.childNamed('app_full_version').val;

                        //determine the number of node servers supported:
                        var nodeServersSupported = (document.childNamed('nodedefs').val == 'true');

                        if (!nodeServersSupported) {
                            isy.nodeServersSupported = 0;
                        } else {
                            var regEx = /(\d+)\.(\d+)\.(\d+)(\w)?/gi;
                            var result = regEx.exec(isy.ISYVersion);
                            var majorVersion = Number(result[1]);
                            var minorVersion = Number(result[2]);
                            var patchVersion = Number(result[3]);
                            var letterVersion = ((result[4] || '') == '') ? 0 : (parseInt(result[4], 36) - 9); //return the letter suffix as a number none=0, A=1, B=2, etc...

                            if (majorVersion < 5) {
                                isy.nodeServersSupported = 0;
                            } else if ((minorVersion == 0 && patchVersion == 11 && letterVersion >= 3) || (minorVersion == 0 && patchVersion > 11) || (minorVersion > 0)) { //5.0.11C increased the number of node servers to 25
                                isy.nodeServersSupported = 25;
                            } else {
                                isy.nodeServersSupported = 10;
                            }
                        }

                        var featuresElement = document.childNamed('features');
                        var features = featuresElement.childrenNamed('feature');
                        for (index = 0; index < features.length; index++) {
                            var thisFeature = features[index];
                            var thisId = thisFeature.childNamed('id').val;
                            if (thisId == '21020') { //Weather Module
                                isy.hasWeather = (thisFeature.childNamed('isInstalled').val == 'true');
                                isy.node.trace('Weather Module is ' + ((isy.hasWeather) ? '' : 'not ') + 'Installed');
                            }  
                        }
                        
                    } catch (err) {
                        isy.nodeServersSupported = 0;
                        isy.node.warn('Error processing ISY version and capabilities: ' + err);
                    }

                    isy.node.debug('Finished loading ISY configuration from ' + isy.address.toString());
                    isy.initialized.config = true;
                    isy.events.emit('item_init_complete', isy);
                }
            } catch (err) {
                isy.node.error("Unable to contact the ISY to get the configuration: " + err);
            }
        }).on('error', function (err, response) {
            isy.node.error("Unable to contact the ISY to get the configuration: " + err);
        }).on('fail', function (data, response) {
            isy.node.error("ISY-JS: Error while contacting ISY for the configuration -- failure");
        }).on('abort', function () {
            isy.node.error("ISY-JS: Abort while contacting ISY for the configuration");
        }).on('timeout', function (ms) {
            isy.node.error("ISY-JS: Timed out contacting ISY for the configuration");
        });
    }

    this.getNodesAndScenes = function () {
        this.node.log('Retrieving nodes and scenes from ISY at ' + this.address.toString());
        var isy = this;
        //Parse known nodes and scenes:
        restler.get(this.protocol + '://' + this.address + '/rest/nodes', this.options).on('complete', function (result, response) {
            try {
                if (isy.checkForFailure(response)) {
                    this.node.error("Unable to contact the ISY to get the list of nodes: " + result.message);
                }
                else {
                    var document = new xmldoc.XmlDocument(result);
                    isy._loadNodeFolders(document);
                    isy._loadNodes(document);
                    isy._loadScenes(document);
                }
            } catch (err) {
                isy.node.error("Unable to contact the ISY to get the list of nodes: " + result.message);
            }
        }).on('error', function (err, response) {
            isy.node.error("Unable to contact the ISY to get the list of nodes: " + err);
        }).on('fail', function (data, response) {
            isy.node.error("ISY-JS: Error while contacting ISY for the list of nodes -- failure");
        }).on('abort', function () {
            isy.node.error("ISY-JS: Abort while contacting ISY for the list of nodes");
        }).on('timeout', function (ms) {
            isy.node.error("ISY-JS: Timed out contacting ISY for the list of nodes");
        });
    }

    this.getPrograms = function () {
        this.node.log('Retrieving programs from ISY at ' + this.address.toString());
        var isy = this;
        //Parse known programs:
        restler.get(this.protocol + '://' + this.address + '/rest/programs?subfolders=true', options).on('complete', function (result, response) {
            if (isy.checkForFailure(response)) {
                isy.node.warn("Unable to contact the ISY to get the list of programs: " + result.message);
            }
            else {
                try {
                    var document = new xmldoc.XmlDocument(result);
                    var programs = document.childrenNamed('program');
                    for (index = 0; index < programs.length; index++) {
                        var id = programs[index].attr.id;
                        if (id in isy.programs) {
                            var thisProgram = isy.programs[id];
                            thisProgram.programDefStatus(programs[index]);
                        } else {
                            var newProgram = new ISYProgram.ISYProgram(isy, programs[index]);
                            isy.programs[newProgram.id] = newProgram;
                        }
                    }
                    isy.node.debug('Finished loading programs from ISY at ' + isy.address.toString());
                    isy.initialized.programs = true;
                    isy.events.emit('item_init_complete', isy);
                } catch (err) {
                    isy.node.warn('Error loading programs from ISY: ' + err);
                }
            }
        }).on('error', function (err, response) {
            isy.node.error("Unable to contact the ISY to get the list of programs: " + err);
        }).on('fail', function (data, response) {
            isy.node.error("ISY-JS: Error while contacting ISY for the list of programs -- failure");
        }).on('abort', function () {
            isy.node.error("ISY-JS: Abort while contacting ISY for the list of programs");
        }).on('timeout', function (ms) {
            isy.node.error("ISY-JS: Timed out contacting ISY for the list of programs");
        });
    }

    this.getVariables = function (type) {
        this.node.log('Retrieving variables from ISY at ' + this.address.toString());
        var isy = this;
        var type_string = '';
        if (type == 1) {
            type_string = 'integer';
        } else if (type == 2) {
            type_string = 'state';
        } else {
            this.node.error(type + ' passed to ISY getVariables function but only 1 or 2 are acceptable');
        }
        var isy = this;

        restler.get(this.protocol + '://' + this.address + '/rest/vars/get/' + type, options).on('complete', function (result, response) {
            if (isy.checkForFailure(response)) {
                isy.node.warn("Unable to contact the ISY to get the list of " + type_string + " variables: " + result.message);
            }
            else {
                try {
                    var document = new xmldoc.XmlDocument(result);
                    var variables = document.childrenNamed('var')
                    for (var index = 0; index < variables.length; index++) {
                        var type = variables[index].attr.type;
                        var var_id = variables[index].attr.id;
                        var id = type + '_' + var_id;
                        if (id in isy.variables) { //variable has already been added locally
                            var thisVariable = variables[id];
                            thisVariable.parseXML(variables[index]);  //update variable values
                        } else { //variable has not yet been instantiated
                            var newVariable = new ISYVariable.ISYVariable(isy, variables[index]);
                            isy.variables[newVariable.id] = newVariable;
                        }
                    }
                    isy.node.debug('Finished loading ' + type_string + ' variables from ISY at ' + isy.address.toString());
                    isy._getVariableNames(type)
                    //if (type == 1) {
                    //    isy.initialized.int_variables = true;
                    //} else if (type == 2) {
                    //    isy.initialized.state_variables = true;
                    //}
                    //isy.events.emit('item_init_complete', isy);
                } catch (err) {
                    isy.node.warn('Error loading variables from ISY: ' + err);
                }
            }
        }).on('error', function (err, response) {
            isy.node.error("Unable to contact the ISY to get the list of " + type_string + " variables: " + err);
        }).on('fail', function (data, response) {
            isy.node.error("ISY-JS: Error while contacting ISY for the list of " + type_string + " variables -- failure");
        }).on('abort', function () {
            isy.node.error("ISY-JS: Abort while contacting ISY for the list of " + type_string + " variables");
        }).on('timeout', function (ms) {
            isy.node.error("ISY-JS: Timed out contacting ISY for the list of " + type_string + " variables");
        });
    }

    this._getVariableNames = function (type) {
        this.node.log('Retrieving variable names from ISY at ' + this.address.toString());
        var isy = this;
        var type_string = '';
        if (type == 1) {
            type_string = 'integer';
        } else if (type == 2) {
            type_string = 'state';
        } else {
            this.node.error(type + ' passed to ISY _getVariableNames function but only 1 or 2 are acceptable');
        }
        var isy = this;

        restler.get(this.protocol + '://' + this.address + '/rest/vars/definitions/' + type, options).on('complete', function (result, response) {
            if (isy.checkForFailure(response)) {
                isy.node.warn("Unable to contact the ISY to get the definitions of " + type_string + " variables: " + result.message);
            }
            else {
                try {
                    var document = new xmldoc.XmlDocument(result);
                    var variables = document.childrenNamed('e')
                    for (var index = 0; index < variables.length; index++) {
                        var var_id = variables[index].attr.id;
                        var id = type + '_' + var_id;
                        if (id in isy.variables) { //variable has already been added locally
                            var thisVariable = isy.variables[id];
                            thisVariable.name = variables[index].attr.name;
                        }
                    }
                    isy.node.debug('Finished loading ' + type_string + ' variable definitions from ISY at ' + isy.address.toString());
                    if (type == 1) {
                        isy.initialized.int_variables = true;
                    } else if (type == 2) {
                        isy.initialized.state_variables = true;
                    }
                    isy.events.emit('item_init_complete', isy);
                } catch (err) {
                    isy.node.warn('Error loading variable definitions from ISY: ' + err);
                }
            }
        }).on('error', function (err, response) {
            isy.node.error("Unable to contact the ISY to get the definitions of " + type_string + " variables: " + err);
        }).on('fail', function (data, response) {
            isy.node.error("ISY-JS: Error while contacting ISY for the definitions of " + type_string + " variables -- failure");
        }).on('abort', function () {
            isy.node.error("ISY-JS: Abort while contacting ISY for the definitions of " + type_string + " variables");
        }).on('timeout', function (ms) {
            isy.node.error("ISY-JS: Timed out contacting ISY for the definitions of " + type_string + " variables");
        });
    }

    this._loadNodeFolders = function (document) {
        try {
            this.node.debug('Loading node folders from ISY at ' + this.address.toString());
            var folders = document.childrenNamed('folder');
            for (index = 0; index < folders.length; index++) {
                var address = folders[index].childNamed('address').val;
                if (address in this.nodeFolders) {
                    var thisFolder = this.nodeFolders[address];
                    thisFolder.name = folders[index].childNamed('name').val
                }
                else {
                    var newFolder = {
                        name: folders[index].childNamed('name').val
                    };
                    this.nodeFolders[address] = newFolder;
                }
            }
            this.node.debug('Finished loading folders from ISY at ' + this.address.toString());
            this.initialized.nodeFolders = true;
            this.events.emit('item_init_complete', this);
        } catch (err) {
            this.node.warn('Error loading folders from ISY: ' + err);
        }
    }

    this._loadNodes = function (document) {
        try {
            this.node.debug('Loading nodes from ISY at ' + this.address.toString());
            var nodes = document.childrenNamed('node');
            for (index = 0; index < nodes.length; index++) {
                var address = nodes[index].childNamed('address').val;
                if (address in this.devices) {
                    var thisNode = this.devices[address];
                    thisNode.nodeDefStatus(nodes[index]); //update info for existing node
                }
                else {
                    var newNode = new ISYNode.ISYNode(this, nodes[index]);
                    this.devices[newNode.address] = newNode;
                }
            }
            this.node.debug('Finished loading nodes from ISY at ' + this.address.toString());
            this.getNodeStatus();
        } catch (err) {
            this.node.warn('Error loading nodes from ISY: ' + err);
        }
    }

    this.getNodeStatus = function () {
        this.node.log('Retrieving node status from ISY at ' + this.address.toString());
        var isy = this;
        //Parse known nodes and scenes:
        restler.get(this.protocol + '://' + this.address + '/rest/status/', this.options).on('complete', function (result, response) {
            try {
                if (isy.checkForFailure(response)) {
                    isy.node.error("Unable to contact the ISY to get node status: " + result.message);
                }
                else {
                    var document = new xmldoc.XmlDocument(result);
                    var nodes = document.childrenNamed('node');
                    for (index = 0; index < nodes.length; index++) {
                        try {
                            var address = nodes[index].attr.id;
                            if (address in isy.devices) {
                                var thisNode = isy.devices[address];
                                thisNode.parseNodeProperties(nodes[index]);
                            } else {
                                isy.node.trace("Status received for " + address + ", but node not initialized");
                            }
                        } catch (err) {
                            isy.node.debug('Error processing properties for ' + isy.address + ': ' + err);
                        }
                    }
                    isy.initialized.nodes = true;
                    isy.events.emit('item_init_complete', isy);
                }
            } catch (err) {
                isy.node.error("Error processing node status: " + err);
            }
        }).on('error', function (err, response) {
            isy.node.error("Unable to contact the ISY to get the node status: " + err);
        }).on('fail', function (data, response) {
            isy.node.error("ISY-JS: Error while contacting ISY for the node status -- failure");
        }).on('abort', function () {
            isy.node.error("ISY-JS: Abort while contacting ISY for the node status");
        }).on('timeout', function (ms) {
            isy.node.error("ISY-JS: Timed out contacting ISY for the node status");
        });
    }

    this._loadScenes = function (document) {
        try {
            this.node.debug('Loading scenes from ISY at ' + this.address.toString());
            var groups = document.childrenNamed('group');
            for (index = 0; index < groups.length; index++) {
                var address = groups[index].childNamed('address').val;
                if (address in this.scenes) {
                    //this.node.debug('Scene has already been added: ' + address);
                } else {
                    var newScene = new ISYScene.ISYScene(this, groups[index]);
                    this.scenes[newScene.address] = newScene;
                }
            }
            this.node.debug('Finished loading scenes from ISY at ' + this.address.toString());
            this.initialized.scenes = true;
            this.events.emit('item_init_complete', this);
        } catch (err) {
            this.node.warn('Error loading scenes from ISY: ' + err);
        }
    }

    this.REST = function (url, successCallback = dummyRESTCallback, errorCallback = dummyRESTCallback) {
        try {
            this.node.trace('Processing REST call to ISY at ' + this.address.toString() + ' url="' + url.toString() + '"');
            var isy = this;
            restler.get(this.protocol + '://' + this.address + url, this.options).on('complete', function (result, response) {
                if (isy.checkForFailure(response)) {
                    errorCallback(result, response);
                }
                else {
                    successCallback(result, response);
                }
            }).on('error', function (result, response) {
                errorCallback(result, response);
            }).on('fail', function (result, response) {
                errorCallback(result, response);
            }).on('abort', function () {
                errorCallback();
            }).on('timeout', function (ms) {
                errorCallback();
            });
        } catch (err) {
            isy.node.warn('Error issuing REST command: ' + err);
        }
    }

    function dummyRESTCallback(result='', response='') {
        try {
            this.node.trace('REST message issued');
        } catch (err) {
            this.node.warn('Error logging message for dummyRESTCallback: ' + err);
        }

    }

    this.initialize();
    return this;
};

module.exports = ISY;