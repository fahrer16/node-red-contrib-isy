var ISY = require('./isy/isy.js');
//var deepEqual = require('fast-deep-equal');

module.exports = function (RED) {
    ///Configuration(server) Node:
    function ISYnode(config) {
        RED.nodes.createNode(this, config);

        this.ip = config.ip;
        this.useHttps = config.useHttps || false;
        this.username = this.credentials.username;
        this.password = this.credentials.password;
        this.connected = false;

        var node = this;

        //initialize connection to ISY.
        try {
            node.log('creating ISY object...')
            node.isy = ISY(node, node.ip, node.username, node.password, node.useHttps);
            node.log('isy object created');
            node.connected = node.isy.connected;

            node.isy.events.on('initialized', function () {
                node.connected = node.connected;
                node.trace('isy initialized, informing other nodes...');
                node.emit('isy_initialized');
            });

            node.isy.events.on('connection-timeout', function () {
                node.connected = node.connected;
            });

            node.isy.events.on('websocket_closed', function () {
                node.connected = node.connected;
            });

        } catch (err) {
            node.error(err);
        }

        //Create HTML endpoint for UI editor to retrieve capabilities:
        RED.httpAdmin.get('/ISY/' + this.id + '/capabilities', function (req, res) {
            try {
                res.json({ "ISYversion": node.isy.ISYVersion, "nodeServersSupported": node.isy.nodeServersSupported, "hasWeather": node.isy.hasWeather , "controls": node.isy.controls, "uom": node.isy.uom});
            } catch (err) {
                node.warn('Error populating ISY capabilities: ' + err);
            }

        });

        //Create HTML endpoint for UI editor to retrieve device list:
        RED.httpAdmin.get('/ISY/' + this.id + '/devices', function (req, res) {
            try {
                var devicesForSelection = [];
                var devices = node.isy.devices;
                for (i in devices) {
                    devicesForSelection.push({ "address": devices[i].address, "name": devices[i].name, "parentName": devices[i].parentName() });
                }
                res.json(devicesForSelection);
            } catch (err) {
                node.warn('Error populating Device Array: ' + err);
            }

        });

        //Create HTML endpoint for UI editor to retrieve scene list:
        RED.httpAdmin.get('/ISY/' + this.id + '/scenes', function (req, res) {
            try {
                var scenesForSelection = [];
                var scenes = node.isy.scenes;
                for (i in scenes) {
                    scenesForSelection.push({ "address": scenes[i].address, "name": scenes[i].name, "parentName": scenes[i].parentName() });
                }
                res.json(scenesForSelection);
            } catch (err) {
                node.warn('Error populating Scene Array: ' + err);
            }

        });

        //Create HTML endpoint for UI editor to retrieve variable list:
        RED.httpAdmin.get('/ISY/' + this.id + '/variables', function (req, res) {
            try {
                var varsForSelection = [];
                var vars = node.isy.variables;
                for (i in vars) {
                    varsForSelection.push({ "id": vars[i].id, "name": vars[i].name });
                }
                res.json(varsForSelection);
            } catch (err) {
                node.warn('Error populating Variable Array: ' + err);
            }

        });

        //Create HTML endpoint for UI editor to retrieve program list:
        RED.httpAdmin.get('/ISY/' + this.id + '/programs', function (req, res) {
            try {
                var programsForSelection = [];
                var programs = node.isy.programs;
                for (i in programs) {
                    programsForSelection.push({ "id": programs[i].id, "name": programs[i].name, "parentName": programs[i].parentName() });
                }
                res.json(programsForSelection);
            } catch (err) {
                node.warn('Error populating Program Array: ' + err);
            }

        });

        this.on('close', function (done) {
            try {
                node.isy.closeWebSocket();
                node.isy.events.on('websocket_closed', function () {
                    done();
                }); 
            } catch (err) {
                node.warn(err);
            }
        });
    }
    RED.nodes.registerType('isy-controller', ISYnode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });
}