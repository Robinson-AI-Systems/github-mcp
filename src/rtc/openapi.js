// Describes the existing restricted HTTP wire surface, not full RTC certification.
const schema=name=>({$ref:`#/components/schemas/${name}`});
const response=name=>({$ref:`#/components/responses/${name}`});
const json=s=>({'application/json':{schema:s}});
const query=(name,s,extra={})=>({name,in:'query',schema:s,...extra});
const path=(name,s)=>({name,in:'path',required:true,schema:s});
const integer=(minimum,maximum,defaultValue)=>({type:'integer',minimum,maximum,
  ...(defaultValue===undefined?{}:{default:defaultValue})});
const text=maxLength=>({type:'string',maxLength});
const NAME={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9_-]+$'};
const HANDLE={type:'string',pattern:'^res_[A-Za-z0-9_-]{20,64}$'};
const read=(operationId,summary)=>({operationId,summary,security:[{rtcPass:[]}],
  responses:{200:response('ReadSuccess'),400:response('InvalidRequest'),401:response('Unauthorized'),
    403:response('Forbidden'),404:response('NotFound'),429:response('RateLimited'),503:response('Unavailable')}});
const body=s=>({required:true,description:'UTF-8 JSON: at most 32768 bytes.',
  content:json(s)});
export function rtcOpenApi(){
  return {openapi:'3.1.0',info:{title:'GitHub Unleashed RTC preview API',version:'0.1.0',
    description:'Scoped service passes; OAuth MCP retained. RTC1 unverified.'},
    paths:{
      '/api/contract':{get:{operationId:'rtcContract',summary:'Public capability and self-reported build evidence',
        security:[],responses:{200:{description:'Non-certified RTC0 manifest',content:json({type:'object'})}}}},
      '/api/openapi.json':{get:{operationId:'rtcOpenApi',summary:'Public API description',security:[],
        responses:{200:{description:'OpenAPI 3.1 description of the existing subset',content:json({type:'object'})}}}},
      '/api/whoami':{get:read('rtcWhoami','View authenticated pass restrictions and service identity')},
      '/api/tools':{get:{...read('rtcSearchTools','Search authorized read metadata'),parameters:[
        query('q',text(200)),query('area',text(64)),query('audience',text(64)),
        query('listing',{type:'string',enum:['compact','catalog'],default:'compact'}),
        query('limit',integer(1,100,20)),query('page',integer(1,1000,1))]}},
      '/api/tools/{name}':{parameters:[path('name',NAME)],
        get:read('rtcDescribeTool','Describe one authorized tool and its argument schema'),
        post:{...read('rtcCallRead','Call one authorized read; body is tool arguments directly'),
          requestBody:body({type:'object',additionalProperties:true}),
          'x-max-utf8-bytes':32768}},
      '/api/tools/_batch':{post:{...read('rtcBatchReads','Validate all args, recheck authority per read; large batches return a retained handle'),
        requestBody:body(schema('BatchRequest')),'x-max-utf8-bytes':32768}},
      '/api/results/{handle}':{parameters:[path('handle',HANDLE)],get:{
        ...read('rtcGetResult','Retrieve only the current pass connection’s retained result'),parameters:[
          query('page',integer(1,100000)),query('pageSize',integer(1,100)),
          query('offset',integer(0,100000000)),
          query('fields',{type:'array',minItems:1,maxItems:20,items:{type:'string',minLength:1,maxLength:64}},
            {style:'form',explode:false,description:'Comma-separated field paths; repeated fields parameters are also accepted.'})]}}
    },
    components:{securitySchemes:{rtcPass:{type:'http',scheme:'bearer',
      description:'Scoped service pass; no OAuth/provider credentials.'}},
      schemas:{
        Success:{type:'object',required:['ok','result'],additionalProperties:false,
          properties:{ok:{const:true},result:{},handle:HANDLE,summary:{type:'string'},mode:{enum:['preview','production']}}},
        Error:{type:'object',required:['ok','error'],additionalProperties:false,properties:{ok:{const:false},
          error:{type:'object',required:['code','what','cause','todo','technical'],additionalProperties:false,
            properties:{code:{type:'string',enum:['permission','pass_expired','pass_revoked','refused_by_guard',
              'rate_limited','invalid_args','not_found','service_error']},what:{type:'string'},cause:{type:'string'},
            todo:{type:'string'},technical:{type:'string'}}}}},
        BatchRequest:{type:'object',required:['calls'],additionalProperties:false,properties:{calls:{
          type:'array',minItems:1,maxItems:10,items:{type:'object',required:['name'],additionalProperties:false,
            properties:{name:NAME,args:{type:'object',additionalProperties:true}}}}}}
      },
      responses:{ReadSuccess:{description:'RTC envelope; large reads include a connection-owned handle.',content:json(schema('Success'))},
        InvalidRequest:{description:'Malformed, oversized or schema-invalid arguments',content:json(schema('Error'))},
        Unauthorized:{description:'Missing, unknown, expired or revoked service pass',content:json(schema('Error'))},
        Forbidden:{description:'Pass scope or guard refused',content:json(schema('Error'))},
        NotFound:{description:'Tool is outside the permitted surface or result is absent',content:json(schema('Error'))},
        RateLimited:{description:'Shared per-pass database rate exhausted',content:json(schema('Error')),
          headers:{'Retry-After':{description:'Seconds before retry',schema:{type:'integer',const:60}}}},
        Unavailable:{description:'Service or required database is unavailable',content:json(schema('Error'))}}
    }
  };
}
