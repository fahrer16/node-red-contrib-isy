var deepEqual = require('fast-deep-equal');

module.exports = function (RED) {
    ///Scene Node
    function ISYSceneNode(config) {
        RED.nodes.createNode(this, config);
        this.initialized = false;
        this.address = config.address;
        this.lastMsg = {};

        var node = this;

        try {
            // Retrieve the config node:
            node.controller = RED.nodes.getNode(config.controller);
            node.status({ fill: "yellow", shape: "dot", text: "connecting..." });

            //once the isy has initialized, establish connection with the scene object:
            if (node.controller.isy.connected) {
                connectScene(node, node.address);
            }
            else {
                node.trace('ISY Scene node (' + node.address + ') waiting for ISY to initialize');
                node.controller.once('isy_initialized', function () {
                    connectScene(node, node.address);
                });
            }
        } catch (err) {
            node.error('ISY Scene Node Error: ' + err);
        }

    }
    RED.nodes.registerType('ISY Scene', ISYSceneNode);

    function connectScene(node, address) {
        try {
            if (node.initialized) { return; } //exit this routine if we've already connected to the scene
            node.trace('ISY initialized, setting up scene node: ' + address);

            node.scene = node.controller.isy.scenes[address];
            if (node.scene !== undefined) {
                //set initial appearance for node:
                node.status({ fill: "green", shape: "dot", text: "connected" });

                node.scene.events.on('node_added', function () { sceneOutput(node); });
                node.scene.events.on('node_removed', function () { sceneOutput(node); });
                node.scene.events.on('parent_updated', function () { sceneOutput(node); });
                node.scene.events.on('name_updated', function () { sceneOutput(node); });

                node.on('input', function (msg) {
                    //msg.payload processing:
                    if (msg.payload !== undefined) {
                        if (msg.payload != 1 || msg.payload == 'true' || msg.payload == true) {
                            node.scene.turnOn();
                        } else if (msg.payload == false || msg.payload == 'false' || msg.payload == 0 || msg.payload == '0') {
                            node.scene.turnOff();
                        }
                    } else if (msg.cmd !== undefined) {
                        node.scene.runCmd(msg.cmd);
                    }
                });

                node.initialized = true;
            } else {
                //device object not yet present in controller instance, wait a few seconds and try again
                node.status({ fill: "yellow", shape: "ring", text: "waiting..." });
                setTimeout(function () { connectScene(node, address); }, 5000);
            }
        } catch (err) {
            node.warn('Error connecting to ISY scene: ' + err)
        }
    }

    function sceneOutput(node) {
        var thisMsg = {
            name: node.scene.name,
            address: node.scene.address,
            enabled: node.scene.enabled,
            parent: node.scene.parent,
            parentType: node.scene.parentType,
            pnode: node.scene.pnode,
            nodes: node.scene.nodes
        }
        if (!deepEqual(node.lastMsg, thisMsg)) {
            node.send(thisMsg);
        }
        node.lastMsg = thisMsg;
    }
}