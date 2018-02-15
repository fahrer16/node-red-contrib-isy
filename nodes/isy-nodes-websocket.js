var deepEqual = require('fast-deep-equal');

module.exports = function (RED) {
    ///Websocket Node (node allows for consumption of raw websocket stream)
    function ISYWebSocketNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        
        try {
            // Retrieve the config node:
            node.controller = RED.nodes.getNode(config.controller);
            node.status({ fill: "yellow", shape: "dot", text: "connecting..." });

            //once the isy has initialized, establish connection with the websocket:
            try {
                var connected = node.controller.isy.connected;
            } catch(err) {
                var connected = false;
            }
            if (connected) {
                connectWebSocket(node);
            }
            else {
                node.trace('Websocket node waiting for ISY to initialize');
                node.controller.once('isy_initialized', function () {
                    connectWebSocket(node);
                });
            }
        } catch (err) {
            node.error('ISY Websocket Error: ' + err);
        }
    }
    RED.nodes.registerType('ISY Websocket', ISYWebSocketNode);

    function connectWebSocket(node) {
        try {
            node.trace('ISY initialized, setting up Websocket node');
            if (node.controller.isy.connected) {
                node.status({ fill: "green", shape: "dot", text: "connected" });
            } else {
                node.status({ fill: "red", shape: "ring", text: "disconnected" });
            }

            node.controller.isy.events.on('initialized', function () {
                node.status({ fill: "green", shape: "dot", text: "connected" });
            });

            node.controller.isy.events.on('connection-timeout', function () {
                node.status({ fill: "yellow", shape: "dot", text: "reconnecting..." });
            });

            node.controller.isy.events.on('websocket_closed', function () {
                node.status({ fill: "red", shape: "ring", text: "disconnected" });
            });

            node.controller.isy.events.on('websocket_event', function (event_type, action_type, document) {
                var msg = {
                    payload: document,
                    info: {
                        event_type: event_type,
                        action_type: action_type
                    }
                };
                node.send(msg);
            });
        } catch (err) {
            node.error(err);
        }

    }
}