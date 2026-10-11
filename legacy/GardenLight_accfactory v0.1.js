// HAP-Nodejs Garden Light Accesorry
//
// https://www.freetronics.com.au/pages/ndrive-quickstart-guide
//
// todo
// -- RGB colour lighting. Requires v2 hardware design
// -- Store light zone name when changed
//
// done
// -- PWM to set light brightness via MOSFET interfacing
// -- use system WIFI mac addr as AccessoryUsername
// -- updated to use npm version of hap-nodejs directory structure (11/4/2020)
// -- Preparation to use HAP-NodeJS as a library, rather than accessory factory as is now. Will allow for depreciation of HAP-NodeJS's Core.js
// -- accessories are advertised using "ciao" backend for hap-nodejs
// -- rewrite to use "common" HomeKit device class
//
// Code version 11/7/2023
// Mark Hulskamp

"use strict";

// Define HAP-NodeJS requirements
var HAP = require("hap-nodejs");

// Define external library requirements
var GPIO = require("rpio");

// Define nodejs module requirements
var os = require("os");
var util = require("util");
var EventEmitter = require("events");

// Define our external module requirements
var HomeKitDevice = require("./HomeKitDevice");
const MDNSPROVIDER = HAP.MDNSAdvertiser.CIAO;           // mDNS Provider we'll use 
const ACCESSORYNAME = "n0rt0nthec4t";                   // Used for manufacturer name of HomeKit device
const ACCESSORYPINCODE = "031-45-154";                  // HomeKit pairing code


class Light extends HomeKitDevice {
    constructor(currentDeviceData, globalEventEmitter) {
        super(ACCESSORYNAME, ACCESSORYPINCODE, HAP.MDNSAdvertiser.CIAO, currentDeviceData.device_uuid, currentDeviceData, globalEventEmitter);

        this.lightZones = [];                           // Array of light zones we have
    }

    // Class functions
    addHomeKitServices(serviceName) {
        if (Array.isArray(this.deviceData.GPIO_LightPins) == true) {
            var subtype = 1;
            this.deviceData.GPIO_LightPins.forEach((GPIO_LightPin) => {
                if (GPIO_LightPin == 12 || GPIO_LightPin == 13 || GPIO_LightPin == 18 || GPIO_LightPin == 19) {
                    var tempService = this.HomeKitAccessory.addService(HAP.Service.Lightbulb, "Light " + subtype, subtype);
                    tempService.addCharacteristic(HAP.Characteristic.Brightness);

                    //
                    GPIO.open(GPIO_LightPin, GPIO.PWM);
                    GPIO.pwmSetClockDivider(2);                     // Clock divider (PWM refresh rate)
                    GPIO.pwmSetRange(GPIO_LightPin, 1000); 
                    GPIO.pwmSetData(GPIO_LightPin, 0);         // light off as default

                    // Set defaults for character
                    tempService.updateCharacteristic(HAP.Characteristic.On, false);
                    tempService.updateCharacteristic(HAP.Characteristic.Brightness, 100);

                    // Setup callbacks for characteristics
                    var context = {"service" : tempService, "power" : false, "GPIO_LightPin" : GPIO_LightPin, "brightness" : 100};

                    tempService.getCharacteristic(HAP.Characteristic.On).on("set", (value, callback) => {this.setPower(context, value, callback); });
                    tempService.getCharacteristic(HAP.Characteristic.Brightness).on("set", (value, callback) => {this.setBrightness(context, value, callback); });
                    tempService.getCharacteristic(HAP.Characteristic.On).on("get", (callback) => {this.getPower(context, callback); });
                    tempService.getCharacteristic(HAP.Characteristic.Brightness).on("get", (callback) => {this.getBrightness(context, callback); });

                    this.lightZones.push(context);  // Store the "context" for this light

                    outputLogging(ACCESSORYNAME, false, "Added Light Zone '%s'", tempService.displayName);
                    subtype = subtype + 1;  // Ready for next light
                }
            });
        }
        outputLogging(ACCESSORYNAME, false, "Setup Garden Light System '%s'", serviceName);
    }

    setPower(context, value, callback) {
        GPIO.pwmSetData(context.GPIO_LightPin, value == true ? context.brightness : 0);
        context.power = value;
        context.service.updateCharacteristic(HAP.Characteristic.On, value);
        if (typeof callback === "function") callback();  // do callback if defined
    }

    getPower(context, callback) {
        if (typeof callback === "function") callback(null, context.power);  // do callback if defined
        return context.power;
    }

    setBrightness(context, value, callback) {
        GPIO.pwmSetData(context.GPIO_LightPin, value);
        context.brightness = value;
        context.service.updateCharacteristic(HAP.Characteristic.Brightness, value);
        if (typeof callback === "function") callback();  // do callback if defined
    }

    getBrightness(context, callback) {
        if (typeof callback === "function") callback(null, context.brightness);  // do callback if defined
        return context.brightness;
    }
}


// General functions
function crc32(valueToHash) {
    var crc32HashTable = [
        0x000000000, 0x077073096, -0x11f19ed4, -0x66f6ae46, 0x0076dc419, 0x0706af48f, -0x169c5acb, -0x619b6a5d, 
        0x00edb8832, 0x079dcb8a4, -0x1f2a16e2, -0x682d2678, 0x009b64c2b, 0x07eb17cbd, -0x1847d2f9, -0x6f40e26f, 
        0x01db71064, 0x06ab020f2, -0xc468eb8, -0x7b41be22, 0x01adad47d, 0x06ddde4eb, -0xb2b4aaf, -0x7c2c7a39, 
        0x0136c9856, 0x0646ba8c0, -0x29d0686, -0x759a3614, 0x014015c4f, 0x063066cd9, -0x5f0c29d, -0x72f7f20b, 
        0x03b6e20c8, 0x04c69105e, -0x2a9fbe1c, -0x5d988e8e, 0x03c03e4d1, 0x04b04d447, -0x2df27a03, -0x5af54a95, 
        0x035b5a8fa, 0x042b2986c, -0x2444362a, -0x534306c0, 0x032d86ce3, 0x045df5c75, -0x2329f231, -0x542ec2a7, 
        0x026d930ac, 0x051de003a, -0x3728ae80, -0x402f9eea, 0x021b4f4b5, 0x056b3c423, -0x30456a67, -0x47425af1, 
        0x02802b89e, 0x05f058808, -0x39f3264e, -0x4ef416dc, 0x02f6f7c87, 0x058684c11, -0x3e9ee255, -0x4999d2c3, 
        0x076dc4190, 0x001db7106, -0x672ddf44, -0x102aefd6, 0x071b18589, 0x006b6b51f, -0x60401b5b, -0x17472bcd, 
        0x07807c9a2, 0x00f00f934, -0x69f65772, -0x1ef167e8, 0x07f6a0dbb, 0x0086d3d2d, -0x6e9b9369, -0x199ca3ff, 
        0x06b6b51f4, 0x01c6c6162, -0x7a9acf28, -0xd9dffb2, 0x06c0695ed, 0x01b01a57b, -0x7df70b3f, -0xaf03ba9, 
        0x065b0d9c6, 0x012b7e950, -0x74414716, -0x3467784, 0x062dd1ddf, 0x015da2d49, -0x732c830d, -0x42bb39b, 
        0x04db26158, 0x03ab551ce, -0x5c43ff8c, -0x2b44cf1e, 0x04adfa541, 0x03dd895d7, -0x5b2e3b93, -0x2c290b05, 
        0x04369e96a, 0x0346ed9fc, -0x529877ba, -0x259f4730, 0x044042d73, 0x033031de5, -0x55f5b3a1, -0x22f28337, 
        0x05005713c, 0x0270241aa, -0x41f4eff0, -0x36f3df7a, 0x05768b525, 0x0206f85b3, -0x46992bf7, -0x319e1b61, 
        0x05edef90e, 0x029d9c998, -0x4f2f67de, -0x3828574c, 0x059b33d17, 0x02eb40d81, -0x4842a3c5, -0x3f459353, 
        -0x12477ce0, -0x65404c4a, 0x003b6e20c, 0x074b1d29a, -0x152ab8c7, -0x622d8851, 0x004db2615, 0x073dc1683, 
        -0x1c9cf4ee, -0x6b9bc47c, 0x00d6d6a3e, 0x07a6a5aa8, -0x1bf130f5, -0x6cf60063, 0x00a00ae27, 0x07d079eb1, 
        -0xff06cbc, -0x78f75c2e, 0x01e01f268, 0x06906c2fe, -0x89da8a3, -0x7f9a9835, 0x0196c3671, 0x06e6b06e7, 
        -0x12be48a, -0x762cd420, 0x010da7a5a, 0x067dd4acc, -0x6462091, -0x71411007, 0x017b7be43, 0x060b08ed5, 
        -0x29295c18, -0x5e2e6c82, 0x038d8c2c4, 0x04fdff252, -0x2e44980f, -0x5943a899, 0x03fb506dd, 0x048b2364b, 
        -0x27f2d426, -0x50f5e4b4, 0x036034af6, 0x041047a60, -0x209f103d, -0x579820ab, 0x0316e8eef, 0x04669be79, 
        -0x349e4c74, -0x43997ce6, 0x0256fd2a0, 0x05268e236, -0x33f3886b, -0x44f4b8fd, 0x0220216b9, 0x05505262f, 
        -0x3a45c442, -0x4d42f4d8, 0x02bb45a92, 0x05cb36a04, -0x3d280059, -0x4a2f30cf, 0x02cd99e8b, 0x05bdeae1d, 
        -0x649b3d50, -0x139c0dda, 0x0756aa39c, 0x0026d930a, -0x63f6f957, -0x14f1c9c1, 0x072076785, 0x005005713, 
        -0x6a40b57e, -0x1d4785ec, 0x07bb12bae, 0x00cb61b38, -0x6d2d7165, -0x1a2a41f3, 0x07cdcefb7, 0x00bdbdf21, 
        -0x792c2d2c, -0xe2b1dbe, 0x068ddb3f8, 0x01fda836e, -0x7e41e933, -0x946d9a5, 0x06fb077e1, 0x018b74777, 
        -0x77f7a51a, -0xf09590, 0x066063bca, 0x011010b5c, -0x709a6101, -0x79d5197, 0x0616bffd3, 0x0166ccf45, 
        -0x5ff51d88, -0x28f22d12, 0x04e048354, 0x03903b3c2, -0x5898d99f, -0x2f9fe909, 0x04969474d, 0x03e6e77db, 
        -0x512e95b6, -0x2629a524, 0x040df0b66, 0x037d83bf0, -0x564351ad, -0x2144613b, 0x047b2cf7f, 0x030b5ffe9, 
        -0x42420de4, -0x35453d76, 0x053b39330, 0x024b4a3a6, -0x452fc9fb, -0x3228f96d, 0x054de5729, 0x023d967bf, 
        -0x4c9985d2, -0x3b9eb548, 0x05d681b02, 0x02a6f2b94, -0x4bf441c9, -0x3cf3715f, 0x05a05df1b, 0x02d02ef8d
    ]
    var crc32 = 0xffffffff; // init crc32 hash;
    valueToHash = Buffer.from(valueToHash);    // convert value into buffer for processing
    for (var index = 0; index < valueToHash.length; index++) {
        crc32 = (crc32HashTable[(crc32 ^ valueToHash[index]) & 0xff] ^ crc32 >>> 8) & 0xffffffff;
    }
    crc32 ^= 0xffffffff;
    return crc32 >>> 0;    // return crc32
}

function getSystemMACAddress() {
    // todo - determine active connection, either wifi or ethernet.
    var systemMAC = "00:00:00:00:00:00";
    var networkInterfaces = os.networkInterfaces();

    Object.keys(networkInterfaces).forEach(network => {
        networkInterfaces[network].forEach(network => {
            if ((network.family.toUpperCase() == "IPV4" || network.internal == true) && network.mac != "00:00:00:00:00:00") {
                // found a MAC address
                systemMAC = network.mac.toUpperCase(); 
            }
        });
    });

    return systemMAC;
}

function outputLogging(accessoryName, useConsoleDebug, ...outputMessage) {
    var timeStamp = String(new Date().getFullYear()).padStart(4, "0") + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0") + " " + String(new Date().getHours()).padStart(2, "0") + ":" + String(new Date().getMinutes()).padStart(2, "0") + ":" + String(new Date().getSeconds()).padStart(2, "0");
    if (useConsoleDebug == false) {
        console.log(timeStamp + " [" + accessoryName + "] " + util.format(...outputMessage));
    }
    if (useConsoleDebug == true) {
        console.debug(timeStamp + " [" + accessoryName + "] " + util.format(...outputMessage));
    }
}


// Startup code
var eventEmitter = new EventEmitter();  // Need a global event emitter. Will be used for messaging between our classes we create

outputLogging(ACCESSORYNAME, false, "Starting " +  __filename + " using HAP-NodeJS library v" + HAP.HAPLibraryVersion());

// Init the GPIO (RPIO) library. This only needs to be done once before using library functions
GPIO.init({gpiomem: false});    // need root access for PWM on GPIO (18, 12, 13, 19)
GPIO.init({mapping: "gpio"});

// For each light, create the HomeKit accessory
var deviceData = {};
deviceData.mac_address = getSystemMACAddress();
deviceData.device_uuid = deviceData.mac_address;
deviceData.serial_number = crc32(deviceData.mac_address).toString();   // Default serial number
deviceData.software_version = HAP.HAPLibraryVersion();
deviceData.manufacturer = ACCESSORYNAME;
deviceData.description = "HomeKit Garden Light System";
deviceData.location = "";
deviceData.model = "HomeKit Garden Light System";
deviceData.GPIO_LightPins = [12, 13];   // A zone will be created for each light GPIO pin specified 

var tempDevice = new Light(deviceData, eventEmitter);
tempDevice.add("Garden Light System", HAP.Accessory.Categories.LIGHTBULB, true);
