const _ = require('lodash');
const { testsMap } = require('./parser');

const NATIVE_TESTS = [
  "appium", "ios", "android", "android_long", "android_load", "selendroid", "android_hybrid",
  "ios_hybrid", "ios_loc_serv", "ios_iwd", "ios_sk", "ios_animation_performance"
];

const APPS = {
  'iOS61': 'http://appium.s3.amazonaws.com/TestApp6.1.app.zip',
  'iOS7': 'http://appium.s3.amazonaws.com/TestApp7.0.app.zip',
  'iOS71': 'http://appium.s3.amazonaws.com/TestApp7.1.app.zip',
  'iOS102': 'http://appium.s3.amazonaws.com/TestApp10.2.app.zip',
  'iOSHybrid6': 'http://appium.s3.amazonaws.com/WebViewApp6.1.app.zip',
  'iOSHybrid7': 'http://appium.s3.amazonaws.com/WebViewApp7.1.app.zip',
  'iOSHybrid102': 'http://appium.s3.amazonaws.com/WebViewApp10.2.app.zip',
  'iOSHybridWK': 'http://appium.s3.amazonaws.com/FLWebView.app.zip',
  'Android': 'http://appium.s3.amazonaws.com/ContactManager.apk',
  'Android9': 'http://appium.s3.amazonaws.com/ContactManager9.apk',
  'AndroidHybrid': 'http://appium.s3.amazonaws.com/ApiDemos-debug-2015-03-19.apk',
  'AndroidHybrid10': 'https://appium.s3.amazonaws.com/ApiDemos-debug-10.apk',
  'AndroidLoad': 'http://appium.s3.amazonaws.com/stressapptest.apk',
  'Selendroid': 'http://appium.s3.amazonaws.com/selendroid-test-app-0.7.0.apk',
  'iOSAnimationPerformance': 'https://www.dropbox.com/s/9fs5551h92gowrv/iOS-Performance.zip?dl=1'
};

const WEB_TESTS = [
  "https", "selfsigned", "connect", "localname", "web_long", "web",
  "web_guinea", "web_fraud", "manual"
];

// given a testSpec from the runner, get a set of caps
function getCaps (testSpec, eventTimings = false) {
  // set up initial caps which we will fix up or override later
  let caps = {
    browserName: testSpec.browser,
    browserVersion: testSpec.version.toString(),
    platformName: testSpec.platform,
    "appium:newCommandTimeout": 3 * 60 * 1000, // Bump newCommandTimeout to 3 minutes
    "appium:autoGrantPermissions": true,
    "sauce:options": {},
  };

  // now set up more caps which we don't want on the caps object at all if
  // they're not truthy
  if (eventTimings) {
    caps.eventTimings = true;
  }
  if (testSpec.orientation) {
    caps['appium:device-orientation'] = testSpec.orientation;
  }
  if (testSpec.device) {
    caps["appium:deviceName"] = testSpec.device;
  }

  // fix up the caps based on all kinds of horrendous logic to do with varying
  // requirements for different tests, platforms, and versions
  fixCaps(testSpec, caps);

  // give ourselves a nice name that's easily readable on Sauce
  caps["sauce:options"]["name"] = getTestName(testsMap[testSpec.test], caps);

  // 'extraCaps' are raw caps parsed from JSON entered on the command line, so
  // we can just extend them onto caps, allowing them to override existing caps
  if (testSpec.extraCaps) {
    _.extend(caps, testSpec.extraCaps);
  }
  return { alwaysMatch: caps, firstMatch: [{}] };
}

function fixCaps (testSpec, caps) {
  // ensure that versions all look like X.Y(.Z) for later parsing
  if (caps.browserVersion && caps.browserVersion.toString().indexOf('.') === -1) {
    caps.browserVersion = caps.browserVersion.toString() + ".0";
  }
  // if we have a device param, or know that we're running a native test, then
  // we know we're using appium so fix up caps according to appium regulations
  if (caps["appium:deviceName"] || _.includes(NATIVE_TESTS, testSpec.test)) {
    fixAppiumCaps(testSpec, caps);
  }

  // by default, prevent requeue of Sauce VMs so we don't get a falsely
  // positive picture of how well our tests are doing
  caps["sauce:options"]['prevent-requeue'] = true;
}


function fixAppiumCaps (testSpec, caps) {
  // if we're running a selfsigned test, make sure we tell appium to keep the
  // keychains
  if (testSpec.test.toLowerCase() === "selfsigned") {
    caps["appium:keepKeyChains"] = true;
  }

  // check for some basic error conditions
  let appiumVer = parseFloat(testSpec.backendVersion) || null;
  if (!appiumVer) {
    throw new Error("You're trying to run an Appium test but didn't set an " +
                    "Appium version with the backendVersion parameter. We " +
                    "need that set in order to determine correct capabilities.");
  }
  if (appiumVer < 1.0) {
    throw new Error("RunSauce only supports Appium 1+");
  }

  caps["sauce:options"]["appiumVersion"] = testSpec.backendVersion.toString();
  if (testSpec.automationName) {
    caps["appiun:automationName"] = testSpec.automationName;
  }
  if (/^\d$/.test(caps["sauce:options"]["appiumVersion"])) {
    // ensure the appium version is validly formed
    caps["sauce:options"]["appiumVersion"] += ".0";
  }
  let tt = testSpec.test.toLowerCase();
  if (_.includes(NATIVE_TESTS, tt)) {
    // if we're running a native test, ensure browserName is not set otherwise
    // this will cause confusion for Sauce
    caps["browserName"]= '';
  }

  // Appium uses SE3-style capabilities, not SE2-style caps, so massage these
  // into their correct names. platformName is set further below.
  // Set a default deviceName based on test type, if it wasn't included
  if (!caps["appium:deviceName"]) {
    if (tt.indexOf('ios') === 0) {
      caps["appium:deviceName"] = 'iPhone Simulator';
    } else {
      caps["appium:deviceName"] = 'Android Emulator';
    }
  }
  // If we're running a local Appium test, ensure we give ourselves a nice high
  // launch timeout (mostly for old Instruments-based tests)
  if (!testSpec.onSauce) {
    caps["appium:launchTimeout"] = 35000;
  }

  // Prepare platform-specific caps for iOS or Android
  if (caps.deviceName[0].toLowerCase() === 'i') {
    fixAppiumIosCaps(caps, tt);
  } else {
    fixAppiumAndroidCaps(caps, tt);
  }

  // If we want a web test, ensure browserName is specified appropriately for
  // the platform
  if (_.includes(WEB_TESTS, tt) && !caps.browserName) {
    if (caps.platformName === "iOS") {
      caps.browserName = "safari";
    } else {
      caps.browserName = "chrome";
    }
  }

  // for iOS web tests, give ourselves a generous webview connection retry
  if (_.includes(WEB_TESTS, tt) && caps.platformName === "iOS") {
    caps["appium:webviewConnectRetries"] = 10;
  }
}

function fixAppiumIosCaps (caps, tt) {
  caps.platformName = 'iOS';
  // set a default browserVersion
  if (!caps.browserVersion) {
    caps.browserVersion = '10.2';
  }
  if (tt === 'ios_animation_performance') {
    caps["appium:app"] = APPS.iOSAnimationPerformance;
  } else if (_.includes(["ios", "ios_loc_serv", "ios_iwd", "ios_sk"], tt)) {
    // choose which native app to use based on browserVersion
    if (parseFloat(caps.browserVersion) >= 10.2) {
      caps["appium:app"] = APPS.iOS102;
    } else {
      caps["appium:app"] = APPS.iOS71;
    }
  } else if (tt === "ios_hybrid") {
    // otherwise we have a hybrid app
    caps["appium:app"] = APPS.iOSHybridWK;
  }
}

function fixAppiumAndroidCaps (caps, tt) {
  caps.platformName = 'Android';
  caps["appium:allowTestPackages"] = true;
  // set up default browserVersion
  if (!caps.browserVersion) {
    caps.browserVersion = '5.0';
  }
  // set up android-specific caps based on test type
  if (_.includes(["android", "android_long"], tt)) {
    if (parseInt(caps.browserVersion, 10) >= 9) {
      caps["appium:app"] = APPS.Android9;
    } else {
      caps["appium:app"] = APPS.Android;
    }
  } else if (tt === 'android_load') {
    caps["appium:app"] = APPS.AndroidLoad;
    caps.deviceName = 'Android GoogleApi Emulator'
    caps.browserVersion = '7.1'
  } else if (tt === 'android_hybrid') {
    caps["appium:appActivity"] = '.view.WebView1';
    caps["appium:app"] = APPS.AndroidHybrid;
    if (parseFloat(caps.browserVersion) >= 10.0) {
        caps["appium:app"] = APPS.AndroidHybrid10;
    }
    if (parseFloat(caps.browserVersion) < 4.4) {
      caps["appium:automationName"] = 'Selendroid';
    }
  }
  if (tt === 'selendroid') {
    caps["appium:automationName"] = 'Selendroid';
    caps["appium:app"] = APPS.Selendroid;
  }
}

function getTestName (test, caps) {
  let platform = caps.platformName || '(platform unspecified)';
  let version = caps.browserVersion || '(version unspecified)';
  let browser = caps.browserName || caps["appium:deviceName"] || '(browser unspecified)';
  if (caps.browserName && caps["appium:deviceName"]) {
    browser = `${caps.browserName} on ${caps["appium:deviceName"]}`;
  }
  if (!caps["appium:deviceName"]) {
    return `${test} (${browser} ${version} on ${platform})`;
  }
  return `${test} (${browser} on ${platform} ${version})`;
}

module.exports = { getCaps };
