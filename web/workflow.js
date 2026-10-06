const profiles={encode:['encode'],decode:['decode'],both:['encode','decode'],full:['encode','decode','rig','util']};

export function parseWorkflow(search=''){
  const value=new URLSearchParams(search).get('workflow');
  return Object.hasOwn(profiles,value)?value:'both';
}

// Workflow tags unlock even the planned controls; temporary modem restrictions
// remain separate so rebuilding the UI cannot accidentally re-enable them.
export function createWorkflowFilter(catalog,workflow,document){
  const tags=new Set(profiles[workflow]||profiles.both),original=new WeakMap(),runtime=new Set();
  const includes=tag=>tags.has(tag);
  const allows=id=>!Object.hasOwn(catalog,id)||catalog[id].some(includes);
  function apply(){
    for(const id of Object.keys(catalog)){
      const element=document.getElementById(id);if(!element)continue;
      const firstApply=!original.has(element);
      if(firstApply)original.set(element,{
        disabled:Boolean(element.disabled),tabIndex:element.getAttribute('tabindex'),
        ariaDisabled:element.getAttribute('aria-disabled'),title:element.getAttribute('title'),
        href:element.getAttribute('href'),role:element.getAttribute('role'),
      });
      const baseline=original.get(element);
      const disabled=!allows(id)||runtime.has(id);
      if('disabled' in element)element.disabled=disabled;
      element.classList.toggle('workflow-disabled',disabled);
      if(disabled)element.setAttribute('aria-disabled','true');
      else if(baseline.ariaDisabled===null)element.removeAttribute('aria-disabled');
      else element.setAttribute('aria-disabled',baseline.ariaDisabled);
      if(disabled)element.dataset.workflowDisabled='true';else delete element.dataset.workflowDisabled;
      if(disabled&&(element.tagName==='A'||baseline.tabIndex!==null))element.setAttribute('tabindex','-1');
      else if(baseline.tabIndex===null)element.removeAttribute('tabindex');
      else element.setAttribute('tabindex',baseline.tabIndex);
      if(element.tagName==='A'){
        if(disabled){element.removeAttribute('href');element.setAttribute('role',baseline.role||'link');}
        else{
          if(baseline.href!==null)element.setAttribute('href',baseline.href);
          if(baseline.role===null)element.removeAttribute('role');else element.setAttribute('role',baseline.role);
        }
      }
      // Old receive-only tooltips would contradict the newly unlocked controls.
      if(firstApply&&baseline.disabled&&!disabled&&baseline.title)element.removeAttribute('title');
    }
    document.querySelectorAll('.qso-row,.config-row').forEach(row=>{
      const fields=Array.from(row.querySelectorAll('input,select,textarea'));
      row.classList.toggle('unavailable',fields.length>0&&fields.every(field=>field.disabled));
    });
  }
  function setRuntimeDisabled(id,disabled){if(disabled)runtime.add(id);else runtime.delete(id);}
  // Native disabled fields cover ordinary input; capture also covers anchors,
  // clickable canvases/rows, and synthetic events dispatched to disabled elements.
  function blockEvent(event){
    if(!event.target.closest?.('[data-workflow-disabled="true"]'))return;
    event.preventDefault();event.stopImmediatePropagation();
  }
  for(const type of ['click','auxclick','pointerdown','pointermove','keydown','input','change','wheel'])
    document.addEventListener(type,blockEvent,{capture:true,passive:false});
  return {workflow,includes,allows,apply,setRuntimeDisabled};
}
