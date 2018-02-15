var deepEqual = require('fast-deep-equal');

module.exports = function (RED) {
    ///Program Node
    function ISYProgramNode(config) {
        RED.nodes.createNode(this, config);

        this.initialized = false;
        this.programId = config.programId;
        this.lastMsg = {};

        var node = this;

        try {
            // Retrieve the config node:
            node.controller = RED.nodes.getNode(config.controller);
            node.status({ fill: "yellow", shape: "dot", text: "connecting..." });

            //once the isy has initialized, establish connection with the program object:
            if (node.controller.isy.connected) {
                connectProgram(node, node.programId);
            }
            else {
                node.trace('ISY Program node (' + node.programId + ') waiting for ISY to initialize');
                node.controller.once('isy_initialized', function () {
                    connectProgram(node, node.programId);
                });
            }
        } catch (err) {
            node.error('ISY Program Node Error: ' + err);
        }

    }
    RED.nodes.registerType('ISY Program', ISYProgramNode);

    function connectProgram(node, id) {
        try {
            if (node.initialized) {
                node.status({ fill: "green", shape: "dot", text: "connected" });
                return;
            } //exit this routine if we've already connected to the program
            node.trace('ISY initialized, setting up program node: ' + id);

            node.program = node.controller.isy.programs[id];
            if (node.program) {
                //set initial appearance for node:
                node.status({ fill: "green", shape: "dot", text: "connected" });

                node.program.events.on('status_change', function () { programOutput(node); });

                node.on('input', function (msg) {
                    //msg.payload processing:
                    if (msg.payload) {
                        node.program.runCmd(msg.payload);
                    }
                });

                node.initialized = true;
            } else {
                //program object not yet present in controller instance, wait a few seconds and try again
                node.status({ fill: "yellow", shape: "ring", text: "waiting..." });
                setTimeout(function () { connectProgram(node, id); }, 5000);
            }
        } catch (err) {
            node.warn('Error connecting to ISY Program: ' + err)
        }
    }

    function programOutput(node) {
        var thisMsg = {
            payload: node.program.status,
            name: node.program.name,
            id: node.program.id,
            parentId: node.program.parentId,
            isFolder: node.program.isFolder,
            enabled: node.program.enabled,
            runAtStartup: node.program.runAtStartup,
            running: node.program.running
        }
        if (!deepEqual(node.lastMsg, thisMsg)) {
            node.send(thisMsg);
        }
        node.lastMsg = thisMsg;
    }
}