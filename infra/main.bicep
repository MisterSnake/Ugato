// Production infrastructure. Everything here must stay free at the project's
// usage level: no registry, no log workspace and no dedicated workload profile.
targetScope = 'resourceGroup'

@description('Region of every resource.')
param location string = 'eastus2'

@description('Prefix of every resource name.')
param namePrefix string = 'ugato'

@description('Full reference of the backend image, ghcr.io/<owner>/<name>:<sha>.')
param image string

@description('Git commit SHA the image was built from.')
param appVersion string

resource staticSite 'Microsoft.Web/staticSites@2024-04-01' = {
  name: '${namePrefix}-web'
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  // No repositoryUrl: the pipeline uploads the build itself.
  properties: {
    stagingEnvironmentPolicy: 'Disabled'
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${namePrefix}-env'
  location: location
  // No appLogsConfiguration: the console log stream works without a workspace.
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource backend 'Microsoft.App/containerApps@2025-01-01' = {
  name: '${namePrefix}-backend'
  location: location
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        // auto also carries WebSocket connections.
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'APP_VERSION'
              value: appVersion
            }
            {
              name: 'ALLOWED_ORIGINS'
              value: 'https://${staticSite.properties.defaultHostname}'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 8000
              }
              initialDelaySeconds: 5
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 8000
              }
              periodSeconds: 10
            }
          ]
        }
      ]
      // Never more than one replica: games live in that process's memory.
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output backendFqdn string = backend.properties.configuration.ingress.fqdn
output frontendHostname string = staticSite.properties.defaultHostname
output staticSiteName string = staticSite.name
