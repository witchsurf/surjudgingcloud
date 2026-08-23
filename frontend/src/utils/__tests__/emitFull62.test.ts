import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generatePreviewHeats } from '../heatGeneration';
import { inferImplicitMappingsForHeat } from '../heatSlotMappingInference';
it('emit full 62 production fixture',()=>{
 const defs=[['BENJAMIN',8,4],['CADET',13,4],['JUNIOR',6,4],['MINIME',4,4],['ONDINE OPEN',5,4],['ONDINE U16',6,4],['OPEN',20,4]] as const;
 const out:any={event_id:10003,categories:[]}; let n=1;
 for(const [category,count,size] of defs){const ps=Array.from({length:count},(_,i)=>({name:`${category}_TEST_${i+1}`,seed:i+1,country:'SN'}));const plans=generatePreviewHeats(ps,'elimination',size,category==='OPEN'?{manOnManFromRound:3,promoteBestSecond:true}:undefined);const slug='p38-full62_'+category.toLowerCase().replace(/[^a-z0-9]+/g,'_');const heats=plans.flatMap(p=>p.heats.map(h=>({id:`${slug}_r${p.round}_h${h.heat_number}`,category,round:p.round,heat_number:h.heat_number,heat_size:h.surfers.length,surfers:h.surfers})));const seq=heats.map(h=>({id:h.id,round:h.round,heat_number:h.heat_number,heat_size:h.heat_size}));const mappings=heats.flatMap(h=>inferImplicitMappingsForHeat(seq,h.id));out.categories.push({category,participants:ps,heats,mappings,policy:category==='OPEN'?{base_format:'elimination',transition_round:3,transition_format:'man_on_man',version:1}:{base_format:'elimination',transition_round:null,transition_format:null,version:1}});n+=count;}writeFileSync('/tmp/p38-full62-production.json',JSON.stringify(out,null,2));expect(out.categories.reduce((s:any,c:any)=>s+c.heats.length,0)).toBe(32);});
