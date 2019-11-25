import unittest
from appium import webdriver

caps = {}
caps['appiumVersion'] = "1.13.0"
caps['automationName'] = 'uiautomator2'
caps['deviceName'] = "Samsung Galaxy Tab S3 GoogleAPI Emulator"
caps['deviceOrientation'] = "portrait"
caps['app'] = "http://appium.s3.amazonaws.com/ApiDemos-debug-2015-03-19.apk"
caps['platformVersion'] = "8.0"
caps['platformName'] = "Android"
driver = webdriver.Remote('http://admin:0e779f56-385a-41be-a562-6f6908bf5acf@localhost:4444/wd/hub', caps)

result = driver.execute_script('mobile: shell', {
    'command': 'dumpsys',
    'args': ['package', 'com.google.android.gms'],
    'includeStderr': True,
    'timeout': 5000
})
print(result)

driver.quit()