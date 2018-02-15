var deepEqual = require('fast-deep-equal');

module.exports = function (RED) {
    ///Variable Node
    function ISYVariableNode(config) {
        RED.nodes.createNode(this, config);

        this.initialized = false;
        this.address = config.address; // should be in format "<variable_type>_<variable_id>"
        this.lastMsg = {};

        var node = this;

        try {
            // Retrieve the config node:
            node.controller = RED.nodes.getNode(config.controller);
            node.status({ fill: "yellow", shape: "dot", text: "connecting..." });

            //once the isy has initialized, establish connection with the variable object:
            if (node.controller.isy.connected) {
                connectVariable(node, node.address);
            }
            else {
                node.trace('ISY Variable node (' + node.address + ') waiting for ISY to initialize');
                node.controller.once('isy_initialized', function () {
                    connectVariable(node, node.address);
                });
            }
        } catch (err) {
            node.error('ISY Variable Node Error: ' + err);
        }

    }
    RED.nodes.registerType('ISY Variable', ISYVariableNode);

    function connectVariable(node, address) {
        try {
            if (node.initialized) { return; } //exit this routine if we've already connected to the variable
            node.trace('ISY initialized, setting up variable node: ' + address);

            node.variable = node.controller.isy.variables[address];
            if (node.variable !== undefined) {
                //set initial appearance for node:
                node.status({ fill: "green", shape: "dot", text: "connected" });

                node.variable.events.on('value_updated', function () { variableOutput(node); });
                node.variable.events.on('init_updated', function () { variableOutput(node); });

                node.on('input', function (msg) {
                    //msg.payload processing:
                    if (!isNaN(msg.payload)) {
                        node.variable.setValue(msg.payload);
                    }
                    if (!isNaN(msg.init)) {
                        node.variable.setInit(msg.init);
                    }
                });

                node.initialized = true;
            } else {
                //variable object not yet present in controller instance, wait a few seconds and try again
                node.status({ fill: "yellow", shape: "ring", text: "waiting..." });
                setTimeout(function () { connectVariable(node, address); }, 5000);
            }
        } catch (err) {
            node.warn('Error connecting to ISY Variable: ' + err)
        }
    }

    function variableOutput(node) {
        var thisMsg = {
            name: node.variable.name,
            id: node.variable.id,
            payload: node.variable.val,
            prec: node.variable.prec,
            init: node.variable.init
        }
        if (!deepEqual(node.lastMsg, thisMsg)) {
            node.send(thisMsg);
        }
        node.lastMsg = thisMsg;
    }
}