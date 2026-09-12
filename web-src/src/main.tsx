import React, {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {FaceLandmarker, FilesetResolver, ObjectDetector} from "@mediapipe/tasks-vision";
import "./style.css";

type FX = {
  displacement:number; twist:number; turbulence:number; bulge:number; pinch:number;
  edge:number; rgb:number; feedback:number; trails:number; noise:number;
  pixel:number; scan:number; aberration:number; chaos:number; threshold:number;
};

const defaults:FX = {
  displacement:42, twist:18, turbulence:35, bulge:22, pinch:10,
  edge:38, rgb:28, feedback:12, trails:20, noise:8,
  pixel:0, scan:0, aberration:16, chaos:12, threshold:0
};

function Slider({name,label,value,set}: {name:keyof FX,label:string,value:number,set:(v:number)=>void}) {
  return <label className="slider"><span>{label}<b>{Math.round(value)}</b></span>
    <input aria-label={label} type="range" min="0" max="100" value={value}
      onChange={e=>set(+e.target.value)}/></label>
}

function App(){
  const video=useRef<HTMLVideoElement>(null), canvas=useRef<HTMLCanvasElement>(null);
  const [running,setRunning]=useState(false), [mirror,setMirror]=useState(true);
  const [recording,setRecording]=useState(false), [mode,setMode]=useState<"face"|"object"|"everything">("everything");
  const [faces,setFaces]=useState(0), [objects,setObjects]=useState(0);
  const [fx,setFx]=useState<FX>(defaults);
  const raf=useRef<number>(0), stream=useRef<MediaStream|null>(null);
  const recorder=useRef<MediaRecorder|null>(null), chunks=useRef<Blob[]>([]);
  const face=useRef<FaceLandmarker|null>(null), detector=useRef<ObjectDetector|null>(null);
  const last=useRef(0);

  const set=(k:keyof FX)=>(v:number)=>setFx(x=>({...x,[k]:v}));
  const reset=()=>setFx(defaults);

  useEffect(()=>()=>{cancelAnimationFrame(raf.current); stream.current?.getTracks().forEach(t=>t.stop())},[]);

  async function start(){
    if(running){stream.current?.getTracks().forEach(t=>t.stop()); cancelAnimationFrame(raf.current); setRunning(false); return}
    try{
      const s=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:"user", width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:60}},
        audio:false
      });
      stream.current=s; video.current!.srcObject=s; await video.current!.play();
      const vision=await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
      );
      face.current=await FaceLandmarker.createFromOptions(vision,{
        baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"},
        runningMode:"VIDEO", numFaces:4, outputFaceBlendshapes:false
      });
      detector.current=await ObjectDetector.createFromOptions(vision,{
        baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite"},
        runningMode:"VIDEO", scoreThreshold:.35, maxResults:12
      });
      setRunning(true); draw(performance.now());
    }catch(e){console.error(e); alert("Camera/model startup failed. Check camera permission and network access.");}
  }

  function draw(t:number){
    const v=video.current!, c=canvas.current!;
    if(!v.videoWidth){raf.current=requestAnimationFrame(draw);return}
    if(c.width!==v.videoWidth||c.height!==v.videoHeight){c.width=v.videoWidth;c.height=v.videoHeight}
    const ctx=c.getContext("2d")!;
    ctx.save(); ctx.translate(mirror?c.width:0,0); ctx.scale(mirror?-1:1,1);
    ctx.drawImage(v,0,0,c.width,c.height); ctx.restore();

    let fl:any=null, od:any=null;
    try{fl=face.current?.detectForVideo(v,t); od=detector.current?.detectForVideo(v,t)}catch{}
    const nf=fl?.faceLandmarks?.length||0, no=od?.detections?.length||0;
    if(t-last.current>120){setFaces(nf);setObjects(no);last.current=t}

    // GPU-style experimental compositing implemented with Canvas 2D primitives + pixel displacement.
    // The pipeline is intentionally modular: replace this compositor with WebGL/WebGPU passes without
    // changing the vision/control layer.
    if(mode!=="object" && fl?.faceLandmarks){
      ctx.save();
      for(const lm of fl.faceLandmarks){
        for(let i=0;i<lm.length;i+=3){
          const p=lm[i], x=(mirror?1-p.x:p.x)*c.width, y=p.y*c.height;
          const r=1.2+fx.displacement*.045;
          ctx.globalAlpha=.12+fx.edge/700;
          ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();
        }
      }
      ctx.restore();
    }
    if(mode!=="face" && od?.detections){
      ctx.save(); ctx.lineWidth=1+fx.edge*.04;
      for(const d of od.detections){
        const b=d.boundingBox, x=mirror?c.width-b.originX-b.width:b.originX;
        ctx.strokeRect(x,b.originY,b.width,b.height);
        if(fx.edge>15){ctx.globalAlpha=.35; for(let k=1;k<4;k++)ctx.strokeRect(x-k*fx.displacement*.08,b.originY-k*fx.displacement*.08,b.width+k*fx.displacement*.16,b.height+k*fx.displacement*.16)}
      } ctx.restore();
    }

    // Full-frame experimental effects.
    const img=ctx.getImageData(0,0,c.width,c.height), d=img.data;
    const step=Math.max(1,Math.floor(1+fx.pixel/8)), shift=Math.floor(fx.rgb/8+fx.aberration/12);
    if(fx.rgb>0||fx.noise>0||fx.threshold>0){
      for(let y=0;y<c.height;y+=step) for(let x=0;x<c.width;x+=step){
        const i=(y*c.width+x)*4, rr=Math.min(c.width-1,Math.max(0,x+shift))*4+y*c.width*4;
        const ll=Math.min(c.width-1,Math.max(0,x-shift))*4+y*c.width*4;
        if(fx.rgb>0){d[i]=d[Math.min(d.length-4,rr)]*(.65+fx.rgb/280); d[i+2]=d[Math.max(0,ll)]*(.65+fx.rgb/280)}
        if(fx.noise>0){const n=(Math.random()-.5)*fx.noise*1.8; d[i]=Math.max(0,Math.min(255,d[i]+n));d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));d[i+2]=Math.max(0,Math.min(255,d[i+2]+n))}
        if(fx.threshold>0){const q=(d[i]+d[i+1]+d[i+2])/3<128-fx.threshold*.7?0:255; d[i]=d[i]*(1-fx.threshold/100)+q*(fx.threshold/100);d[i+1]=d[i];d[i+2]=d[i]}
      }
      ctx.putImageData(img,0,0);
    }
    if(fx.edge>0){
      ctx.save(); ctx.globalCompositeOperation="screen"; ctx.globalAlpha=fx.edge/300;
      ctx.filter=`contrast(${1+fx.edge/35}) saturate(${1+fx.edge/20})`;
      ctx.drawImage(c,fx.chaos*.08,fx.chaos*.04,c.width,c.height);
      ctx.restore();
    }
    if(fx.scan>0){
      ctx.save();ctx.globalAlpha=fx.scan/300;ctx.lineWidth=1;
      for(let y=0;y<c.height;y+=Math.max(2,Math.floor(12-fx.scan/12))) {ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke()}
      ctx.restore();
    }
    raf.current=requestAnimationFrame(draw);
  }

  function toggleRecord(){
    if(recording){recorder.current?.stop();setRecording(false);return}
    const c=canvas.current!, s=c.captureStream(60);
    const r=new MediaRecorder(s,{mimeType:"video/webm;codecs=vp9"});
    chunks.current=[]; r.ondataavailable=e=>e.data.size&&chunks.current.push(e.data);
    r.onstop=()=>{const blob=new Blob(chunks.current,{type:"video/webm"});
      const br=(window as any).Android;
      if(br&&br.saveVideo){const fr=new FileReader();fr.onload=()=>{const b64=(fr.result as string).split(",")[1];br.saveVideo(b64,`experimental-${Date.now()}.webm`,"video/webm")};fr.readAsDataURL(blob);return}
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`experimental-${Date.now()}.webm`;a.click()};
    recorder.current=r;r.start();setRecording(true);
  }

  return <main>
    <header><div><strong>EXPERIMENTAL CAMERA</strong><small>REAL-TIME VISION / GEOMETRY LAB</small></div>
      <div className="status"><i className={running?"on":""}></i>{running?"LIVE":"OFFLINE"}</div></header>
    <section className="stage"><canvas ref={canvas}/>{!running&&<div className="idle">CAMERA OFFLINE<br/><small>PRESS INITIALIZE</small></div>}
      <div className="hud"><span>FACE {faces}</span><span>OBJ {objects}</span><span>{canvas.current?.width||0}×{canvas.current?.height||0}</span></div></section>
    <section className="controls">
      <div className="toolbar">
        <button onClick={start}>{running?"STOP":"INITIALIZE CAMERA"}</button>
        <button onClick={()=>setMirror(x=>!x)}>FLIP {mirror?"ON":"OFF"}</button>
        <button onClick={()=>setMode(m=>m==="everything"?"face":m==="face"?"object":"everything")}>TARGET: {mode.toUpperCase()}</button>
        <button className={recording?"rec":""} disabled={!running} onClick={toggleRecord}>{recording?"STOP REC":"REC"}</button>
        <button onClick={reset}>RESET</button>
      </div>
      <div className="grid">
        <fieldset><legend>VISION</legend>
          <Slider name="edge" label="EDGE" value={fx.edge} set={set("edge")}/>
          <Slider name="noise" label="NOISE" value={fx.noise} set={set("noise")}/>
          <Slider name="threshold" label="THRESHOLD" value={fx.threshold} set={set("threshold")}/>
          <Slider name="aberration" label="ABERRATION" value={fx.aberration} set={set("aberration")}/>
        </fieldset>
        <fieldset><legend>GEOMETRY</legend>
          <Slider name="displacement" label="DISPLACEMENT" value={fx.displacement} set={set("displacement")}/>
          <Slider name="turbulence" label="TURBULENCE" value={fx.turbulence} set={set("turbulence")}/>
          <Slider name="twist" label="TWIST" value={fx.twist} set={set("twist")}/>
          <Slider name="bulge" label="BULGE" value={fx.bulge} set={set("bulge")}/>
          <Slider name="pinch" label="PINCH" value={fx.pinch} set={set("pinch")}/>
        </fieldset>
        <fieldset><legend>CHAOS / TIME</legend>
          <Slider name="chaos" label="CHAOS" value={fx.chaos} set={set("chaos")}/>
          <Slider name="rgb" label="RGB SPLIT" value={fx.rgb} set={set("rgb")}/>
          <Slider name="feedback" label="FEEDBACK" value={fx.feedback} set={set("feedback")}/>
          <Slider name="trails" label="TRAILS" value={fx.trails} set={set("trails")}/>
          <Slider name="scan" label="SCANLINES" value={fx.scan} set={set("scan")}/>
        </fieldset>
      </div>
    </section>
  </main>
}
createRoot(document.getElementById("root")!).render(<App/>);
