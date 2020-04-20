var EventEmitter = require('events');
let uom = require('./uom.json');

var ISYNode = function (controller_node, xmlNodeDef) {
    this.events = new EventEmitter.EventEmitter();
    this.controller = controller_node;
    this.initialized = false;

    try {
        this.address = xmlNodeDef.childNamed('address').val;
        this.name = xmlNodeDef.childNamed('name').val;
        this.controller.node.debug('Initializing Node: ' + this.name.toString() + ' (' + this.address.toString() + ')');
        this.enabled = tryStringToBool(xmlNodeDef.childNamed('enabled').val);
        this.type = xmlNodeDef.childNamed('type').val;
        this.nodeDefId = xmlNodeDef.attr.nodeDefId;
        try {
            this.parent = xmlNodeDef.childNamed('parent').val;
            this.parentType = xmlNodeDef.childNamed('parent').attr.type;
        } catch (err) {
            this.parent = '';
            this.parentType = '';
        }
        this.deviceClass = xmlNodeDef.childNamed('deviceClass').val;
        this.pnode = xmlNodeDef.childNamed('pnode').val;
        this.properties = {};

    } catch (err) {
        this.controller.node.warn('Error creating node: ' + err);
        return;
    }

    this.nodeDefStatus(xmlNodeDef);
    this.initialized = true;
}

ISYNode.prototype.parentName = function () {
    try {
        if (this.parent == '' || this.parentType == '') {
            return '';
        } else {
            var nodeFolderList = this.controller.nodeFolders;
            var deviceList = this.controller.devices;

            var thisParent = this.parent;
            var thisParentName = '';

            var i = 0;
            while (i < 4 && (thisParent in deviceList)) { //loop through to find the folder that this node belongs to
                thisParentName = (thisParentName == '') ? deviceList[thisParent].name : deviceList[thisParent].name + ' / ' + thisParentName;
                thisParent = deviceList[thisParent].parent || '';
                i++; //safeguard to prevent excessive looping
            }
            if (thisParent in nodeFolderList) {
                if (thisParentName != '') {
                    thisParentName = ' / ' + thisParentName;
                }
                thisParentName = nodeFolderList[thisParent].name + thisParentName;
            }
            return thisParentName || '';
        }
    } catch (err) {
        this.controller.node.debug('Error getting parent name for ' + this.name + ' (' + this.address + '): ' + err);
        return '';
    }
}

ISYNode.prototype.nodeDefStatus = function (xmlNodeDef) {
    try {
        this.enabled = tryStringToBool(xmlNodeDef.childNamed('enabled').val);
        this.wattage = tryStringToNum(xmlNodeDef.childNamed('wattage').val);
        try {
            this.mainProp = xmlNodeDef.childNamed('property').attr.id;
        } catch (err) {
            this.mainProp = '';
            this.controller.node.trace('Node has no main property: ' + this.name.toString() + ' (' + this.address.toString() + ')');
        }

        this.parseNodeProperties(xmlNodeDef);

        if (this.initialized) {
            this.events.emit('all_properties_updated');
        }

    } catch (err) {
        this.controller.node.warn('Error processing node properties for ' + this.address + ': ' + err);
    }
}

ISYNode.prototype.parseNodeProperties = function (xmlNodeDef) {
    try {
        this.controller.node.trace('Updating properties for ' + this.address);
        var xmlProperties = xmlNodeDef.childrenNamed('property');
        if (xmlProperties !== undefined) { //if we have an entire properties section (from /rest/node/<node id>), then populate/update all properties
            for (i = 0; i < xmlProperties.length; i++) {
                var id = xmlProperties[i].attr.id;
                this.properties[id] = {
                    value: tryStringToNum(xmlProperties[i].attr.value),
                    formatted: xmlProperties[i].attr.formatted,
                    uomId: uom,
                    uom: uomIdToString(xmlProperties[i].attr.uom)
                };
            }
        } 
    } catch (err){
        this.controller.node.warn('Error parsing node properties for ' + this.address + ': ' + err);
    }
}

ISYNode.prototype.updatedProperty = function (id, value, formatted, uom) {

    try {
        this.properties[id] = {
            value: tryStringToNum(value),
            formatted: formatted,
            uomId: uom,
            uom: uomIdToString(uom)
        };
        this.events.emit('property_updated', id);
    } catch (err) {
        this.controller.node.warn('Error updating property on ' + this.address + ': ' + err);
    }
}

ISYNode.prototype.updatedParent = function (new_parent, new_parentType) {
    try {
        this.parent = new_parent;
        this.parentType = new_parentType;
        this.events.emit('parent_updated');
    } catch (err) {
        this.controller.node.warn('Error updating parent on ' + this.address + ': ' + err);
    }
}

ISYNode.prototype.updatedName = function (new_name) {
    try {
        this.name = new_name;
        this.events.emit('name_updated');
    } catch (err) {
        this.controller.node.warn('Error updating name on ' + this.address + ': ' + err);
    }
}

ISYNode.prototype.updatedWattage = function (new_wattage) {
    try {
        this.wattage = tryStringToNum(new_wattage);
        this.events.emit('property_updated','wattage');
    } catch (err) {
        this.controller.node.warn('Error updating wattage on ' + this.address + ': ' + err);
    }
}

ISYNode.prototype.getStatus = function () {
    try {
        ///rest/nodes/<node-id>
        var url = '/rest/nodes/' + this.address;
        this.controller.REST(url, nodeDefStatus)
    } catch (err) {

    }
}

ISYNode.prototype.runCmd = function (cmd, params = []) {
    try {
        ///rest/nodes/<node-id>/cmd/<command_name>/<param1>/<param2>/.../<param5>
        //this.controller.node.trace('Command received. cmd: ' + cmd.toString() + ', params: ' + params.toString());

// CET: Added If == Query to handle Queries since it is not part of command from the Rest documentation
        var url ="";
	if ( cmd == "QUERY" ) {
		url = '/rest/query/' + this.address;
	} else {
        	url = '/rest/nodes/' + this.address + '/cmd/' + cmd;
	

        	if (Array.isArray(params) && params != []) {
            		params.forEach(function (value, index) {
                		url += ('/' + value);
            		});
        	} else {
            		url += '/' + params.toString();
        	}
	}

        this.controller.node.log('Sending command (' + cmd + ') as url ('+url+') ');
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error issuing command (' + cmd + ') to scene ' + this.id + ': ' + err);
    }
}

ISYNode.prototype.turnOn = function () {
    this.runCmd('DON');
}

ISYNode.prototype.turnOff = function () {
    this.runCmd('DOF');
}

ISYNode.prototype.enable = function () {
    ///rest/nodes / <node-id>/enable
    try {
        var url = '/rest/nodes/' + this.address + '/enable';
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error enabling node ' + this.id + ': ' + err);
    }
}

ISYNode.prototype.disable = function () {
    ///rest/nodes / <node-id>/disable
    try {
        var url = '/rest/nodes/' + this.address + '/disable';
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error disabling node ' + this.id + ': ' + err);
    }
}

ISYNode.prototype.enabledDisabled = function (enable_disable) {
    try {
        this.enabled = (enable_disable == 'enable');
        this.events.emit(enable_disable + 'd');

    } catch (err) {
        this.controller.node.warn('Error processing node enable-disable event: ' + err);
    }
}

function uomIdToString(uomId) {
    try {
        return uom[uomId].name;
    } catch (err) {
        return uomId;
    }
}

function tryStringToBool(string) {
    try {
        if (string == 'true') {
            return true;
        } else if (string == 'false') {
            return false;
        } else {
            return string;
        }
    } catch (err) {
        return string;
    }
}

function tryStringToNum(string) {
    try {
        return Number(string);
    } catch (err) {
        return string;
    }
}

exports.ISYNode = ISYNode;
