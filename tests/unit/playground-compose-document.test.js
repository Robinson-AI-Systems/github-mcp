import {it,expect} from 'vitest';
import {composeDocument} from '../../src/playground/compose-document.js';
it('reads bounded Compose block YAML with quoted values, indentless lists and volume records without dropping following keys',()=>{
 const d=composeDocument(`name: fixture
services:
  coding:
    networks:
    - workspace
    ports: []
    environment:
      KEY: "ed25519:PUBLIC"
      URL: https://example.test/path#part
      TEXT: 'it''s # data'
    volumes:
      - type: volume
        source: files
        target: /workspace/repo
        read_only: true
networks:
  workspace:
    name: fixture-private
    internal: true
`);
 expect(d.services.coding.networks).toEqual(['workspace']);expect(d.services.coding.ports).toEqual([]);expect(d.services.coding.environment).toEqual({KEY:'ed25519:PUBLIC',URL:'https://example.test/path#part',TEXT:"it's # data"});expect(d.services.coding.volumes).toEqual([{type:'volume',source:'files',target:'/workspace/repo',read_only:true}]);expect(d.networks.workspace.internal).toBe(true);
});
it('rejects aliases, tags, duplicate keys, merge keys, multiline/directive documents, prototype keys and resource bombs',()=>{
 for(const s of ['services: &reuse {}','services: *reuse','services: !!map {}','services: {}\nservices: {}','services:\n  <<: {}','__proto__: {}','services: |\n  coding: {}','---\nservices: {}\n---\nnetworks: {}','services:\n\tcoding: {}','services: "unfinished','services: {}\n  orphan: true','x: '+ 'a'.repeat(2*1024*1024)])expect(()=>composeDocument(s),s.slice(0,70)).toThrow();
 const nested=Array.from({length:35},(_,i)=>' '.repeat(i*2)+'x:').join('\n')+'\n'+' '.repeat(70)+'x: true';expect(()=>composeDocument(nested)).toThrow();
});
