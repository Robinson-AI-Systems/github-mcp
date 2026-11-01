import {createCredentials} from '../github/credentials.js';

// This is the service App's OAuth configuration, never a member's provider
// bearer. Resolve ONLY the configured numeric App, using its existing AAD.
// `credentials` (optional): a store built with the shared root App copy (`rootApps`), so a replaced client secret
// (docs/KEY-ROTATION.md) is used at once even where `db` is a person's own store holding an older copy.
export async function pilotAppClient({env,db,credentials=null}){
  const hasId=!!env.GITHUB_PILOT_APP_CLIENT_ID;
  const hasSecret=!!env.GITHUB_PILOT_APP_CLIENT_SECRET;
  // Preserve explicit configuration, but never repair a partial/mismatched
  // pair by mixing one secret with another App's identifier.
  if(hasId||hasSecret){
    if(!hasId||!hasSecret)throw Error('Private App configuration unavailable.');
    return {clientId:env.GITHUB_PILOT_APP_CLIENT_ID,clientSecret:env.GITHUB_PILOT_APP_CLIENT_SECRET};
  }
  const id=Number(env.GITHUB_PILOT_APP_ID);
  if(!Number.isSafeInteger(id)||id<=0)throw Error('Private App configuration unavailable.');
  const app=await db.getApp(id);
  if(!app||app.id!==id||!app.client_id||!app.client_secret_enc)
    throw Error('Private App configuration unavailable.');
  const client=await (credentials??createCredentials({db,env})).clientCredentials(id);
  if(!client?.clientId||!client.clientSecret)throw Error('Private App configuration unavailable.');
  return client;
}
