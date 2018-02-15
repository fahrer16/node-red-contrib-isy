var deepEqual = require('fast-deep-equal');

module.exports = function (RED) {
    ///Device Node
    function ISYDeviceNode(config) {
        RED.nodes.createNode(this, config);
        
        this.initialized = false;
        this.address = config.address || '';
        var node = this;
        this.lastMsg = {};

        try {
            // Retrieve the config node:
            node.controller = RED.nodes.getNode(config.controller);
            node.status({ fill: "yellow", shape: "dot", text: "connecting..." });

            //once the isy has initialized, establish connection with the device object:
            if (node.controller.isy.connected) {
                connectDevice(node, node.address);
            }
            else {
                node.trace('Device node (' + node.address + ') waiting for ISY to initialize');
                node.controller.once('isy_initialized', function () {
                    connectDevice(node, node.address);
                });
            }
        } catch (err) {
            node.error('ISY Device Node Error: ' + err);
        }

    }
    RED.nodes.registerType('ISY Device', ISYDeviceNode);

    function connectDevice(node, address) {
        try {
            if (node.initialized) { return; } //exit this routine if we've already connected to the device

            node.trace('ISY initialized, setting up device node: ' + address);
            node.device = node.controller.isy.devices[address];
            if (node.device) {
                //set initial appearance for node:
                if (node.device.enabled) {
                    node.status({ fill: "green", shape: "dot", text: "connected" });
                } else {
                    node.status({ fill: "grey", shape: "ring", text: "device disabled" });
                }

                node.device.events.on('all_properties_updated', function () { deviceOutput(node); });
                node.device.events.on('property_updated', function (id) { deviceOutput(node); });
                node.device.events.on('parent_updated', function () { deviceOutput(node); });
                node.device.events.on('name_updated', function () { deviceOutput(node); });
                node.device.events.on('enabled', function () {
                    node.status({ fill: "green", shape: "dot", text: "connected" });
                    deviceOutput(node);
                });
                node.device.events.on('disabled', function () {
                    node.status({ fill: "grey", shape: "ring", text: "device disabled" });
                    deviceOutput(node);
                });

                node.on('input', function (msg) {
                    //msg.payload processing:
                    if (msg.payload !== undefined) {
                        if (msg.payload == false || msg.payload == 'false' || msg.payload == 0 || msg.payload == '0') {
                            node.device.turnOff();
                        } else if (!isNaN(msg.payload) && msg.payload != true) {
                            node.device.runCmd('DON', [msg.payload]);
                        } else if (msg.payload == 'true' || msg.payload == true) {
                            node.device.turnOn();
                        }
                    } else if (msg.cmd !== undefined) {
                        node.device.runCmd(msg.cmd, msg.params);
                    }
                });

                node.initialized = true;
            } else {
                //device object not yet present in controller instance, wait a few seconds and try again
                node.status({ fill: "yellow", shape: "ring", text: "waiting..." });
                setTimeout(function () { connectDevice(node, address); }, 5000);
            }
        } catch (err) {
            node.warn('Error connecting to ISY Device: ' + err)
        }
    }

    function deviceOutput(node) {
        var mainValue = '';
        var mainProp = node.device.mainProp;
        try {
            if (node.device.mainProp in node.device.properties) {
                mainValue = node.device.properties[node.device.mainProp].value;
            } else if ('ST' in node.device.properties) {
                mainValue = node.device.properties['ST'].value;
                mainProp = 'ST';
            }
        } catch (err) {
            
        }
        var thisMsg = {
            payload: mainValue,
            topic: mainProp,
            name: node.device.name,
            address: node.device.address,
            enabled: node.device.enabled,
            type: node.device.type,
            nodeDefId: node.device.nodeDefId,
            parent: node.device.parent,
            parentType: node.device.parentType,
            deviceClass: node.device.deviceClass,
            pnode: node.device.pnode,
            wattage: node.device.wattage,
            mainProp: node.device.mainProp,
            properties: node.device.properties
        }
        if (!deepEqual(node.lastMsg,thisMsg)) {
            node.send(thisMsg);
        }
        node.lastMsg = thisMsg;
    }
}