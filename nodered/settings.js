const path = require('path');

module.exports = {
    uiPort: process.env.PORT || 1880,
    mqttReconnectTime: 15000,
    serialReconnectTime: 15000,
    debugMaxLength: 1000,
    flowFile: 'flows.json',
    flowFilePretty: true,
    credentialSecret: false,
    httpAdminRoot: '/',
    httpNodeRoot: '/',
    userDir: '.',
    editorTheme: {
        projects: {
            enabled: false
        }
    },
    functionGlobalContext: {
        os: require('os')
    },
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    }
}
