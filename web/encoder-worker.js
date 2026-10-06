import createCore from './fldigi-core.js';
import {createEncoderSession} from './encoder-session.js';

try{
  const core=await createCore();
  const session=createEncoderSession(core,(message,transfers=[])=>postMessage(message,transfers));
  self.onmessage=({data})=>{try{session.handle(data);}catch(error){postMessage({type:'error',job:data.job,message:error.message||String(error)});}};
  postMessage({type:'ready'});
}catch(error){postMessage({type:'error',message:'Cannot load the fldigi encoder: '+error.message});}
