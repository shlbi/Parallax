'use client';

import {useEffect,useRef,useState} from 'react';
import type {Map as LeafletMap} from 'leaflet';

export function InteractiveMap({lat,lng,name}:{lat:number;lng:number;name:string}) {
 const container=useRef<HTMLDivElement>(null);
 const mapRef=useRef<LeafletMap|null>(null);
 const [failed,setFailed]=useState(false);

 useEffect(()=>{
  let cancelled=false;
  let resize:ResizeObserver|undefined;
  setFailed(false);
  import('leaflet').then(L=>{
   if(cancelled||!container.current)return;
   const map=L.map(container.current,{scrollWheelZoom:false,zoomControl:true,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView([lat,lng],14);
   mapRef.current=map;
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
   }).on('tileerror',()=>{if(!cancelled)setFailed(true);}).on('tileload',()=>{if(!cancelled)setFailed(false);}).addTo(map);
   resize=new ResizeObserver(()=>{if(!cancelled)map.invalidateSize();});
   resize.observe(container.current);
  }).catch(()=>{if(!cancelled)setFailed(true);});
  return()=>{cancelled=true;resize?.disconnect();mapRef.current?.stop();mapRef.current?.remove();mapRef.current=null;};
 },[lat,lng]);

 return <><div ref={container} className="leaflet-workspace-map" role="region" aria-label={`Interactive map of ${name}`} tabIndex={0}/>{failed&&<div className="map-load-error" role="status">Some map tiles are unavailable. Try another area or open Google Maps below.</div>}</>;
}
