import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWorkflowFilter,parseWorkflow} from '../web/workflow.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../web/workflow.json',import.meta.url)));
const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const staticControls=new Map([...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)]
  .filter(match=>/\bid="/.test(match[2])).map(([,tag,attrs])=>[/\bid="([^"]+)"/.exec(attrs)[1],{tag,attrs}]));

for(const value of ['', '?workflow=', '?workflow=invalid', '?workflow=toString', '?other=encode'])assert.equal(parseWorkflow(value),'decode');
for(const value of ['encode','decode','both','full'])assert.equal(parseWorkflow('?other=1&workflow='+value),value);

class Element{
  constructor(tag='button',attrs=''){
    this.tagName=tag.toUpperCase();this.dataset={};this.attributes={};this.classes=new Set();
    this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
    if(['button','input','select','textarea'].includes(tag))this.disabled=/\bdisabled\b/.test(attrs);
    for(const [,key,value]of attrs.matchAll(/([\w-]+)="([^"]*)"/g))this.attributes[key]=value;
  }
  getAttribute(name){return this.attributes[name]??null;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  closest(){return this.dataset.workflowDisabled==='true'?this:this.parentElement?.closest();}
}
function ui(profile){
  const elements=new Map(Object.keys(catalog).map(id=>{
    const definition=staticControls.get(id);return [id,new Element(definition?.tag,definition?.attrs)];
  }));
  const contactRow=new Element('div');contactRow.querySelectorAll=()=>[elements.get('contact-call'),elements.get('contact-name')];
  const listeners={};
  const document={getElementById:id=>elements.get(id),querySelectorAll:()=>[contactRow],
    addEventListener:(type,handler,options)=>{assert.equal(options.capture,true);listeners[type]=handler;}};
  const filter=createWorkflowFilter(catalog,profile,document);filter.apply();
  return {elements,filter,listeners,contactRow};
}

// All cataloged fields follow the union, even controls marked disabled in HTML.
for(const profile of ['decode','encode','both','full']){
  const {elements,filter,listeners,contactRow}=ui(profile);
  for(const [id,tags]of Object.entries(catalog)){
    const enabled=profile==='full'||tags.some(tag=>profile==='both'?['encode','decode'].includes(tag):tag===profile);
    const element=elements.get(id);
    if('disabled'in element)assert.equal(element.disabled,!enabled,`${profile}: ${id}`);
    assert.equal(element.getAttribute('aria-disabled'),enabled?null:'true',`${profile}: ${id} accessibility`);
    assert.equal(element.classes.has('workflow-disabled'),!enabled);
  }
  assert.equal(contactRow.classes.has('unavailable'),profile!=='full');
  assert.equal(elements.get('help-reception-reports').getAttribute('tabindex'),profile==='full'?null:'-1');
  assert.equal(elements.get('help-reception-reports').getAttribute('href'),profile==='full'?'https://pskreporter.info/pskmap':null);
  assert.equal(elements.get('scope').getAttribute('tabindex'),profile==='encode'?'-1':'0');

  filter.setRuntimeDisabled('frequency',true);filter.apply();assert.equal(elements.get('frequency').disabled,true);
  filter.setRuntimeDisabled('frequency',false);filter.apply();assert.equal(elements.get('frequency').disabled,false);
  filter.setRuntimeDisabled('afc',true);filter.apply();filter.setRuntimeDisabled('afc',false);filter.apply();
  assert.equal(elements.get('afc').disabled,profile==='encode','modem updates cannot bypass the workflow');

  // Configuration page changes replace their fields rather than updating them.
  const replacement=new Element('input','disabled');elements.set('config-txPpm',replacement);filter.apply();
  assert.equal(replacement.disabled,profile==='decode');
  const status=elements.get('status-message');status.setAttribute('title','Current status');filter.apply();
  assert.equal(status.getAttribute('title'),'Current status','filtering preserves updated tooltips');

  const blocked=elements.get(profile==='encode'?'rx-text':'tx-text');
  for(const type of ['click','auxclick','pointerdown','pointermove','keydown','input','change','wheel']){
    let prevented=false,stopped=false;
    listeners[type]({target:blocked,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
    assert.equal(stopped,profile==='encode'||profile==='decode');assert.equal(prevented,stopped);
  }
  const decorativeChild=new Element('span');decorativeChild.parentElement=elements.get('help-reception-reports');
  let stopped=false;listeners.click({target:decorativeChild,preventDefault(){},stopImmediatePropagation(){stopped=true;}});
  assert.equal(stopped,profile!=='full','nested artwork cannot activate a disabled link');
}
console.log('Passed: workflow URL defaults, all 495 catalog entries, runtime restrictions, dynamic replacement, and disabled event handling.');
