# griptape-messenger-integration
An API for messengers to integrate with Griptape apps

Deploys a set of Azure functions to handle incoming messages, send them to a Griptape App deployed to Griptape Cloud, and returns the output back to the messenger.

## Prerequisites
- An Azure subscription
- An Azure CosmosDB account
- Installed the Azure CLI
- Installed the Azure Function CLI
- Created a Griptape App and deployed it to Griptape Cloud
- node v18 or later
- npm v9.6.7 or later

## Integrations

### Groupme
The Groupme integration allows you to handle messages in a Groupme group and send messages in the group as a Groupme Bot. Check the Groupme documentation for creating a bot. Fill out the necessary values that are found in the [`settings.json`](example.settings.json) for Groupme.

## Deploy
- Fill out the [`example.settings.json` file](example.settings.json) and rename it to `local.settings.json`.
  - set `IS_LOCAL` to `"false"` to make sure the function URLs are resolved correctly.
- Fill out the [`example.env` file](example.env) and rename it to `.env`.
- Run `npm run deploy:azure` to deploy your function app.
