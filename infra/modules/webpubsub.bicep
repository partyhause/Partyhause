// modules/webpubsub.bicep — Azure Web PubSub
// Realtime transport for live event/guest
// updates. The API server publishes change events; the web client subscribes.

@description('Azure region')
param location string

@description('Web PubSub resource name')
param pubsubName string

@description('Sku name')
param skuName string = 'Standard_S1'

@description('Unit count')
param unitCount int = 1

resource pubsub 'Microsoft.SignalRService/webPubSub@2023-02-01' = {
  name: pubsubName
  location: location
  sku: {
    name: skuName
    capacity: unitCount
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    tls: {
      clientCertEnabled: false
    }
    liveTraceConfiguration: {
      enabled: 'false'
    }
    // Declared, not assumed. The template previously omitted networkACLs, and
    // an ARM PUT without the property deletes the live value: what-if showed
    // the deploy stripping a Deny-by-default posture someone set imperatively,
    // silently rewidening the service to allow-all. Deny default with exactly
    // the four connection classes the app uses (server publishes, browser
    // subscribes, REST admin, trace) is the state to hold.
    networkACLs: {
      defaultAction: 'Deny'
      publicNetwork: {
        allow: ['ServerConnection', 'ClientConnection', 'RESTAPI', 'Trace']
      }
    }
  }
}

output pubsubName string = pubsub.name
output pubsubId string = pubsub.id
output endpoint string = pubsub.properties.hostName
output primaryKey string = pubsub.listKeys().primaryKey
output primaryConnectionString string = pubsub.listKeys().primaryConnectionString
