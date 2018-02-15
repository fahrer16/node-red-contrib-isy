# node-red-contrib-isy
UDI ISY994i integration for Node-RED

This node requires a [UDI ISY 994i controller](https://www.universal-devices.com/).

##This project provides several nodes:
*Websocket: Subscribes to all events published via websocket by the ISY and exposes the parsed XML for use in Node-Red flows.  Additional information about event category is also provided in the message.
*Device: Allows for commands to be issued to a selected ISY device and subscribes to changes in that device.
*Scene: Allows for commands to be issued to a selected ISY scene and subscribes to changes in that scene.
*Program: Allows for commands to be issued to a selected ISY program and subscribes to changes in that program's state.
*Variable: Allows for variable value and init values to be set.  Subscribes to changes in variable values.

This project is in no way supported nor endorsed by UDI nor the author.  No warranty is provided for the software and if you choose to use it, you do so at you own risk.

Version History:
*1.0.0: Initial Release