import createCore from './fldigi-core.js';
import {createDecoderSession} from './decoder-session.js';

try {
  const core=await createCore();
  const session=createDecoderSession(core,(message,transfers=[])=>postMessage(message,transfers));
  self.onmessage=({data})=>{try{session.handle(data);}catch(error){postMessage({type:'error',message:error.message||String(error),generation:data.generation});}};
  postMessage({type:'ready',modes:JSON.parse(core.UTF8ToString(core._web_modes()))});
} catch(error){postMessage({type:'error',message:'Cannot load the fldigi WASM decoder: '+error.message});}
