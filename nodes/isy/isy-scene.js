var EventEmitter = require('events');

var ISYScene = function (controller_node, xmlSceneDef) {
    this.events = new EventEmitter.EventEmitter();
    this.controller = controller_node;
    try {
        this.address = xmlSceneDef.childNamed('address').val;
        this.name = xmlSceneDef.childNamed('name').val;
        this.controller.node.debug('Initializing Scene: ' + this.name.toString() + ' (' + this.address.toString() + ')');
        try {
            this.parent = xmlSceneDef.childNamed('parent').val;
            this.parentType = xmlSceneDef.childNamed('parent').attr.type;
        } catch (err) {
            this.parent = '';
            this.parentType = '';
        }
        try {
            this.deviceGroup = xmlSceneDef.childNamed('deviceGroup').val;
        } catch (err) {
            this.deviceGroup = '';
        }
        try {
            this.pnode = xmlSceneDef.childNamed('pnode').val;
        } catch (err) {
            this.pnode = '';
        }
        this.nodes = [];

        try {
            var members = xmlSceneDef.childNamed('members');
            var links = members.childrenNamed('link');
            for (var index = 0; index < links.length; index++) {
                this.nodes.push(links[index].val);
            }
        } catch (err) {
            this.controller.debug('Error adding members to scene ' + this.name.toString() + '(' + this.address.toString() + '): ' + err);
        }
    } catch (err) {
        this.controller.node.warn('Error creating Scene: ' + err);
    }
}

ISYScene.prototype.parentName = function () {
    try {
        var nodeFolderList = this.controller.nodeFolders;
        if (this.parent in nodeFolderList) {
            return nodeFolderList[this.parent].name || '';
        } else {
            return '';
        }
    } catch (err) {
        this.controller.node.debug('Error getting parent name for ' + this.name + ' (' + this.address + '): ' + err);
        return '';
    }
}

ISYScene.prototype.addedNode = function (node) {
    try {
        if (this.nodes.indexOf(node) == -1) { //node not already present in scene
            this.nodes.push(node);
            this.events.emit('node_added', node);
        }
    } catch (err) {
        this.controller.node.warn('Error adding node ' + node + ' to scene ' + this.address);
    }
}

ISYScene.prototype.removedNode = function (node) {
    try {
        removeArrayElement(this.nodes, node);
        this.events.emit('node_removed', node);
    } catch (err) {
        this.controller.node.warn('Error removing node ' + node + ' from scene ' + this.address);
    }
}

ISYScene.prototype.updatedParent = function (new_parent, new_parentType) {
    try {
        this.parent = new_parent;
        this.parentType = new_parentType;
        this.events.emit('parent_updated');
    } catch (err) {
        this.controller.node.warn('Error updating parent on ' + this.address + ':' + err);
    }
}

ISYScene.prototype.updatedName = function (new_name) {
    try {
        this.name = new_name;
        this.events.emit('name_updated');
    } catch (err) {
        this.controller.node.warn('Error updating name on ' + this.address + ': ' + err);
    }
}

ISYScene.prototype.runCmd = function (cmd) {
    try {
        ///rest/nodes/<node-id>/cmd/<command_name>/<param1>/<param2>/.../<param5>
        var url = '/rest/nodes/' + this.address + '/cmd';
        for (i = 0; i < arguments.length; i++) {
            cmd += ('/' + arguments[i]);
        }
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error issuing command (' + cmd + ') to scene ' + this.address + ': ' + err);
    }
}

ISYScene.prototype.turnOn = function () {
    this.runCmd('DON');
}

ISYScene.prototype.turnOff = function () {
    this.runCmd('DOF');
}

ISYScene.prototype.enable = function () {
    ///rest/nodes / <node-id>/enable
    try {
        var url = '/rest/nodes/' + this.address + '/enable';
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error enabling scene ' + this.address + ': ' + err);
    }
}

ISYScene.prototype.disable = function () {
    ///rest/nodes / <node-id>/disable
    try {
        var url = '/rest/nodes/' + this.address + '/disable';
        this.controller.REST(url);
    } catch (err) {
        this.controller.node.warn('Error disabling scene ' + this.address + ': ' + err);
    }
}

ISYScene.prototype.enabledDisabled = function (enable_disable) {
    try {
        this.enabled = (enable_disable == 'enable');
        this.events.emit(enable_disable + 'd');

    } catch (err) {
        this.controller.node.warn('Error processing scene enable-disable event: ' + err);
    }
}

function removeArrayElement(array, element) {
    const index = array.indexOf(element);

    if (index !== -1) {
        array.splice(index, 1);
    }
}

exports.ISYScene = ISYScene;