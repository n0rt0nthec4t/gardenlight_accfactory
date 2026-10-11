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
//
// Version 11/4/2020
// Mark Hulskamp

var JSONPackage = require('../../package.json')
var Accessory = require('../').Accessory; 
var Service = require('../').Service;
var Characteristic = require('../').Characteristic;
var uuid = require('../').uuid;
var os = require('os');
var GPIO = require('rpio');

// Defines for the accessory
const AccessoryName =  "Garden Lights";                 // name of accessory
const AccessoryPincode = "031-45-154";                  // pin code for paring 
const AccessoryManufacturer = "Mark Hulskamp";          // manufacturer (optional)
const AccessoryModel = "HomeKit Garden Lights v1";      // model (optional)
const AccessorySerialNumber = "MH20200411";             // serial number (optional) 
const AccessoryFirmwareRevision = JSONPackage.version;  // firmware revision (optional)

const maxRange = 1000;

// Create the "light" object. This can be used as the template for multiple awnings under the one accessory
function LightClass() {
    this.__accessory = null;                // Parent accessory object
    this.__LightService = null;             // HomeKit service for this awning
    this.__LightBrightness = 100;           // Cached light brightness (0-255)
    this.GPIO_LightPin = 0;                 // GPIO Pin for triggering light relay
}

LightClass.prototype = {
	addLight: function(HomeKitAccessory, thisServiceName, serviceNumber) {
        this.__accessory = HomeKitAccessory;

		// Add this light to the "master" accessory and set properties
        this.__LightService = HomeKitAccessory.addService(Service.Lightbulb, thisServiceName, serviceNumber); 

        // Add optional characteristics we'll use
        this.__LightService.addCharacteristic(Characteristic.Brightness);
        
		// Initialise the GPIO input/output PINs for this awning
		GPIO.init({gpiomem: false});    // need root access for PWM on GPIO (18, 12, 13, 19)
		GPIO.init({mapping: 'gpio'});
       
        if (this.GPIO_LightPin != 0) {
            GPIO.open(this.GPIO_LightPin, GPIO.PWM);
            GPIO.pwmSetClockDivider(2);                     // Clock divider (PWM refresh rate)
            GPIO.pwmSetRange(this.GPIO_LightPin, maxRange); 
            GPIO.pwmSetData(this.GPIO_LightPin, 0);         // light off as default
        }

        // Setup Homekit callbacks
        this.__LightService.getCharacteristic(Characteristic.On).on('set', this.setLightOnOff.bind(this));
        this.__LightService.getCharacteristic(Characteristic.Brightness).on('set', this.setLightBrightness.bind(this));

        // Initalise some defaults
        this.__LightService.getCharacteristic(Characteristic.On).updateValue(false);
        this.__LightService.getCharacteristic(Characteristic.Brightness).updateValue(0);

        console.log("Setup garden lights '%s' on '%s'", thisServiceName, HomeKitAccessory.username);
        return this.__LightService;   // Return object to this service
    },

    setLightOnOff: function(state, callback) {
        GPIO.pwmSetData(this.GPIO_LightPin, (state == true ? this.__LightService.getCharacteristic(Characteristic.Brightness).value : 0)); // If one, use light brightness otherwise, 0
        
        this.__LightService.getCharacteristic(Characteristic.On).updateValue(state);
        callback();
    },

    setLightBrightness: function(value, callback) {
        GPIO.pwmSetData(this.GPIO_LightPin, value);

        this.__LightBrightness = value; // cache the value for later
        this.__LightService.getCharacteristic(Characteristic.Brightness).updateValue(value);
        callback();
    },
}

// Use the wifi mac address for the HomeKit username
var AccessoryUsername = "";
var tempNetworkInfo = os.networkInterfaces().wlan0;
for (var index in tempNetworkInfo) {
    if (tempNetworkInfo[index].family.toUpperCase() == "IPV4") {
        AccessoryUsername = tempNetworkInfo[index].mac.toUpperCase(); 
    }
}

if (AccessoryUsername != "") {
    // Create the light controller accessory
    var gardenLightAccessory = exports.accessory = new Accessory(AccessoryName, uuid.generate("hap-nodejs:accessories:gardenlights_"));
    gardenLightAccessory.username = AccessoryUsername; 
    gardenLightAccessory.pincode = AccessoryPincode; 
    gardenLightAccessory.category = Accessory.Categories.LIGHTBULB; // Show accessory type as light bulb in HomeKit paring window
    gardenLightAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, AccessoryManufacturer);
    gardenLightAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Model, AccessoryModel);
    gardenLightAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.SerialNumber, AccessorySerialNumber);
    gardenLightAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.FirmwareRevision, AccessoryFirmwareRevision);

    // Create the lights for the HomeKit garden light controller accessory
    var LightZone1 = new LightClass();
    LightZone1.GPIO_LightPin = 12;
    LightZone1.addLight(gardenLightAccessory, "Light Zone 1", 1);

    var LightZone2 = new LightClass();
    LightZone2.GPIO_LightPin = 13;
    LightZone2.addLight(gardenLightAccessory, "Light Zone 2", 2);
}

// cleanup if process stopped.. Mainly used to ensure lights are off if process stops
var signals = { 'SIGINT': 2, 'SIGTERM': 15 };
Object.keys(signals).forEach(function (signal) {
    process.on(signal, function () {
        GPIO.write(LightZone1.GPIO_LightPin, GPIO.LOW);
        GPIO.close(LightZone1.GPIO_LightPin);

        GPIO.write(LightZone2.GPIO_LightPin, GPIO.LOW);
        GPIO.close(LightZone2.GPIO_LightPin);
    });
});