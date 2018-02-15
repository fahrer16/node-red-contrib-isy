var EventEmitter = require('events');

var ISYProgram = function (controller_node, xmlProgramDef) {
    this.events = new EventEmitter.EventEmitter();
    this.controller = controller_node;
    try {
        this.id = xmlProgramDef.attr.id;
        this.name = xmlProgramDef.childNamed('name').val;
        this.controller.node.debug('Initializing Program: ' + this.name.toString() + ' (' + this.id.toString() + ')');
        this.parentId = xmlProgramDef.attr.parentId || ''; //top folder for programs has no parent
        this.isFolder = tryStringToBool(xmlProgramDef.attr.folder);
        this.programDefStatus(xmlProgramDef);
        this.possibleCommands = ['run', 'runthen', 'runelse', 'stop', 'enable', 'disable', 'enablerunatstartup', 'disablerunatstartup'];
    } catch (err) {
        this.controller.node.warn('Error creating program: ' + err);
    }
}

ISYProgram.prototype.programDefStatus = function (xmlProgramDef) {
    try {
        this.enabled = tryStringToBool(xmlProgramDef.attr.enabled); //if there's no "enabled" attribute, this is a folder, which is essentially always enabled
        this.runAtStartup = tryStringToBool(xmlProgramDef.attr.runAtStartup);
        this.status = tryStringToBool(xmlProgramDef.attr.status);
        this.running = tryStringToBool(xmlProgramDef.attr.running); //folders do not run, default to 'idle' for folders.
    } catch (err) {
        this.controller.node.warn('Error setting program ' + this.id + ' status from program definition: ' + err);
    }
}

ISYProgram.prototype.parentName = function () {
    try {
        var programList = this.controller.programs;
        if (this.parentId == '') {
            return '';
        }
        else if (this.parentId in programList) {
            return programList[this.parentId].name || '';
        } else {
            return '';
        }
    } catch (err) {
        this.controller.node.debug('Error getting parent name for ' + this.name + ' (' + this.id + '): ' + err);
        return '';
    }
}

ISYProgram.prototype.websocketStatus = function (xmlEventInfo) {
    try {
        try {
            //update Program Enable/disable status
            if (typeof xmlEventInfo.childNamed('on') !== 'undefined') {
                this.enabled = true;
            } else {
                this.enabled = false;
            }
        } catch (err) {
            this.enabled = false;
        }

        //update Program true/false status
        var run_states = { 1: 'idle', 2: 'then', 3: 'else' };
        var prog_states = { 1: 'unknown', 2: true, 3: false, F: 'not loaded' };
        var status_raw = xmlEventInfo.childNamed('s').val.toString();
        var bit1 = status_raw.charAt(0);
        var bit2 = status_raw.charAt(1);
        //this.controller.node.trace('Program ' + this.id + ' raw status: ' + bit1 + ',' + bit2 );

        this.status = tryStringToBool(prog_states[bit1]);
        this.running = run_states[bit2];
        
        this.events.emit('status_change');
    } catch (err) {
        this.controller.node.warn('Error updating program status: ' + err);
    }
}
    ;
ISYProgram.prototype.runCmd = function (cmd) {
    try {
        if (this.possibleCommands.indexOf(cmd.toLowerCase()) == -1) {
            this.controller.node.warn('Invalid command (' + cmd + ') issued to ' + this.id);
        } else {
            ///rest/programs/<pgm-id>/<pgm-cmd>
            var url = '/rest/programs/' + this.id + '/' + cmd;
            this.controller.REST(url);
        }
    } catch (err) {
        this.controller.node.warn('Error issuing program ' + this.id + ' command: ' + err);
    }
}

ISYProgram.prototype.runIf = function () {
    this.runCmd('run');
}

ISYProgram.prototype.runThen = function () {
    this.runCmd('runThen');
}

ISYProgram.prototype.runElse = function () {
    this.runCmd('runElse');
}

ISYProgram.prototype.stop = function () {
    this.runCmd('stop');
}

ISYProgram.prototype.enable = function () {
    this.runCmd('enable');
}

ISYProgram.prototype.disable = function () {
    this.runCmd('disable');
}

ISYProgram.prototype.enableRunAtStartup = function () {
    this.runCmd('enableRunAtStartup');
}

ISYProgram.prototype.disableRunAtStartup = function () {
    this.runCmd('disableRunAtStartup');
}

ISYProgram.prototype.getStatus = function () {
    try {
        ///rest/programs/<pgm-id>
        var url = '/rest/programs/' + this.id;
        this.controller.REST(url, this.programDefStatus);
    } catch (err) {
        this.controller.node.warn('Error getting program ' + this.id + ' status: ' + err);
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

exports.ISYProgram = ISYProgram;