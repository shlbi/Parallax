export type EntityType = 'person' | 'organization' | 'document' | 'location' | 'account' | 'event';
export type RelationGroup = 'family' | 'social' | 'professional' | 'place' | 'reference';
export type ClaimStatus = 'supported' | 'review' | 'disputed';
export type Entity = {id:string;name:string;type:EntityType;subtitle:string;x:number;y:number;confidence:number;description:string;source:string;date:string;initials?:string};
export type Connection = {id:string;from:string;to:string;label:string;group:RelationGroup;confidence:number;status:ClaimStatus;source:string;quote:string;note?:string};
export const colors:Record<EntityType,string>={person:'#c7d9b7',organization:'#89adbb',document:'#aea1bf',location:'#c1a477',account:'#9bafb4',event:'#c38d79'};
export const groups:Record<RelationGroup,{name:string;color:string}>={family:{name:'Family',color:'#c5d4b1'},social:{name:'Social',color:'#8dbfc1'},professional:{name:'Professional',color:'#b3a0ce'},place:{name:'Place',color:'#d0a46f'},reference:{name:'References',color:'#788891'}};
export const entities:Entity[]=[
{id:'alex',name:'Alex Mercer',type:'person',subtitle:'Researcher · PX-001',x:47,y:45,confidence:100,description:'Central participant in the fictional Northlight case. A researcher linked to a family declaration, collaborators, project records and a controlled field study.',source:'Enrollment record · PX-001',date:'2026-10-01',initials:'AM'},
{id:'elena',name:'Elena Mercer',type:'person',subtitle:'Mother · PX-003',x:24,y:23,confidence:100,description:'A fictional enrolled participant. The sample family declaration explicitly records Elena as Alex’s mother. This relationship is declared, not inferred from a name or appearance.',source:'Family declaration · REL-01',date:'2026-10-01',initials:'EM'},
{id:'jamie',name:'Jamie Mercer',type:'person',subtitle:'Sibling · PX-004',x:44,y:13,confidence:100,description:'A fictional participant identified as Alex’s sibling in the sample family declaration. Both records refer to the same declared family relationship.',source:'Family declaration · REL-01',date:'2026-10-01',initials:'JM'},
{id:'rowan',name:'Rowan Ellis',type:'person',subtitle:'Friend · PX-005',x:24,y:61,confidence:96,description:'A fictional friend of Alex. The relationship is explicitly recorded in a sample participant statement; shared events alone would not establish friendship.',source:'Relationship statement · REL-02',date:'2026-10-02',initials:'RE'},
{id:'sam',name:'Sam Okafor',type:'person',subtitle:'Neighbor · PX-006',x:39,y:83,confidence:95,description:'A fictional enrolled neighbor. The relation is declared in the sample study register. No residential address or precise personal location is represented.',source:'Relationship statement · REL-03',date:'2026-10-02',initials:'SO'},
{id:'northlight',name:'Northlight Labs',type:'organization',subtitle:'Research organization',x:76,y:24,confidence:97,description:'Fictional research organization connected to the participant through the project brief and research profile.',source:'Project brief · NL-01',date:'2026-10-02',initials:'NL'},
{id:'maya',name:'Maya Chen',type:'person',subtitle:'Co-author · PX-002',x:73,y:54,confidence:98,description:'Fictional collaborator and enrolled participant. Co-authorship is supported by the paper. A separate friendship claim is disputed by the sample evidence.',source:'Paper author list · DOC-04',date:'2026-10-03',initials:'MC'},
{id:'paper',name:'Urban Systems',type:'document',subtitle:'Research paper · DOC-04',x:65,y:82,confidence:98,description:'Sample research paper listing Alex Mercer and Maya Chen as co-authors, with Northlight Labs as the research affiliation.',source:'Sample paper · page 1',date:'2026-10-03'},
{id:'profile',name:'@alex.mercer',type:'account',subtitle:'Research profile',x:9,y:44,confidence:92,description:'Fictional professional profile included in the demonstration fixture. No external account lookup is performed.',source:'Profile snapshot · WEB-01',date:'2026-10-02'},
{id:'article',name:'Research dispatch',type:'document',subtitle:'Interview · DOC-02',x:59,y:8,confidence:86,description:'Fictional interview about the Northlight research project. Publication date conflicts with the sample masthead; review is required.',source:'Sample interview · paragraph 3',date:'2026-10-04'},
{id:'studio',name:'Field station A',type:'location',subtitle:'Controlled test site',x:89,y:79,confidence:100,description:'Illustrative study site for the designated camera simulation. Map locations and scene events are fictional and do not represent participant whereabouts.',source:'Study register · SITE-A',date:'2026-10-06'},
{id:'domain',name:'northlight.example',type:'account',subtitle:'Organization domain',x:89,y:9,confidence:97,description:'Reserved example domain for the fictional research organization.',source:'Organization profile · WEB-02',date:'2026-10-02'},
{id:'workshop',name:'Systems workshop',type:'event',subtitle:'Research event',x:12,y:84,confidence:83,description:'Fictional workshop in the sample research programme. Attendance by Alex remains a claim for review.',source:'Sample programme · EVT-01',date:'2026-09-24'},
{id:'dataset',name:'Field observations',type:'document',subtitle:'Session log · DOC-08',x:92,y:51,confidence:100,description:'Synthetic event log for the controlled study. Every observation is a demonstration fixture.',source:'Sample observation log',date:'2026-10-06'},
{id:'project',name:'Project Lumen',type:'event',subtitle:'Research initiative',x:57,y:63,confidence:95,description:'Fictional research project linking a paper, the lab and a designated experiment site.',source:'Sample project brief · NL-01',date:'2026-10-05'},
{id:'civic',name:'Civic Research',type:'organization',subtitle:'Publisher',x:10,y:9,confidence:78,description:'Fictional publisher of the interview. Its publication date needs verification against the sample masthead.',source:'Publication masthead · DOC-02',date:'2026-10-04'},
];
export const connections:Connection[]=[
{id:'r01',from:'elena',to:'alex',label:'MOTHER',group:'family',confidence:100,status:'supported',source:'REL-01 · Family declaration',quote:'Elena Mercer is recorded as Alex Mercer’s mother in the signed sample declaration.'},
{id:'r02',from:'alex',to:'jamie',label:'SIBLING',group:'family',confidence:100,status:'supported',source:'REL-01 · Family declaration',quote:'Alex and Jamie Mercer are listed as siblings in the same fictional family record.'},
{id:'r03',from:'elena',to:'jamie',label:'PARENT',group:'family',confidence:100,status:'supported',source:'REL-01 · Family declaration',quote:'Elena is recorded as a parent of Jamie in the sample declaration.'},
{id:'r04',from:'alex',to:'rowan',label:'FRIEND',group:'social',confidence:96,status:'supported',source:'REL-02 · Participant statement',quote:'Alex and Rowan explicitly describe each other as friends in the fixture.'},
{id:'r05',from:'alex',to:'sam',label:'NEIGHBOR',group:'place',confidence:95,status:'supported',source:'REL-03 · Participant statement',quote:'Alex and Sam identify their relationship as neighbors. This sample includes no home addresses.'},
{id:'r06',from:'rowan',to:'sam',label:'ACQUAINTANCE',group:'social',confidence:82,status:'review',source:'REL-04 · Workshop note',quote:'The workshop note describes an introduction between Rowan and Sam.',note:'One source. The scope of this relationship needs review.'},
{id:'r07',from:'alex',to:'northlight',label:'RESEARCHER AT',group:'professional',confidence:97,status:'supported',source:'NL-01 · Project brief',quote:'Alex Mercer is listed as a researcher affiliated with Northlight Labs.'},
{id:'r08',from:'alex',to:'maya',label:'CO-AUTHOR',group:'professional',confidence:98,status:'supported',source:'DOC-04 · Author list',quote:'Alex Mercer and Maya Chen appear together on the paper’s author list.'},
{id:'r09',from:'alex',to:'maya',label:'FRIEND?',group:'social',confidence:42,status:'disputed',source:'REL-05 · Conflicting statements',quote:'One sample note calls Maya a friend; another describes the relationship as strictly professional.',note:'Co-authorship is not evidence of friendship. Keep this claim separate from the supported professional link.'},
{id:'r10',from:'alex',to:'paper',label:'AUTHORED',group:'professional',confidence:98,status:'supported',source:'DOC-04 · Paper',quote:'Alex is named as an author of Urban Systems.'},
{id:'r11',from:'alex',to:'profile',label:'PROFILE',group:'reference',confidence:92,status:'supported',source:'WEB-01 · Profile snapshot',quote:'The fictional profile is linked to the enrollment record.'},
{id:'r12',from:'alex',to:'article',label:'INTERVIEWED',group:'reference',confidence:86,status:'review',source:'DOC-02 · Interview',quote:'The interview names Alex, but two sample publication dates conflict.',note:'Identity linkage is supported in this fixture; the publication date remains unresolved.'},
{id:'r13',from:'northlight',to:'domain',label:'PUBLISHES',group:'reference',confidence:97,status:'supported',source:'WEB-02 · Organization profile',quote:'The reserved example domain belongs to the fictional organization.'},
{id:'r14',from:'maya',to:'paper',label:'CO-AUTHORED',group:'professional',confidence:98,status:'supported',source:'DOC-04 · Paper',quote:'Maya is listed as a co-author of Urban Systems.'},
{id:'r15',from:'northlight',to:'maya',label:'COLLABORATOR',group:'professional',confidence:94,status:'supported',source:'NL-01 · Project brief',quote:'The project brief names Maya Chen as a collaborator.'},
{id:'r16',from:'rowan',to:'workshop',label:'ATTENDED',group:'reference',confidence:83,status:'review',source:'EVT-01 · Programme',quote:'Rowan is listed in a draft programme. Attendance has not been corroborated.'},
{id:'r17',from:'paper',to:'project',label:'DOCUMENTS',group:'reference',confidence:95,status:'supported',source:'DOC-04 · Paper',quote:'Urban Systems documents the fictional Project Lumen study.'},
{id:'r18',from:'project',to:'studio',label:'STUDY SITE',group:'place',confidence:100,status:'supported',source:'SITE-A · Study register',quote:'Field station A is a designated test site for Project Lumen.'},
{id:'r19',from:'maya',to:'dataset',label:'REVIEWED',group:'professional',confidence:100,status:'supported',source:'DOC-08 · Review log',quote:'Maya reviewed the synthetic observation log.'},
{id:'r20',from:'dataset',to:'studio',label:'RECORDED AT',group:'place',confidence:100,status:'supported',source:'DOC-08 · Sample log',quote:'The fictional session log is associated with the designated study site.'},
{id:'r21',from:'civic',to:'article',label:'PUBLISHED',group:'reference',confidence:78,status:'review',source:'DOC-02 · Masthead',quote:'The article names Civic Research as publisher; its date differs from the masthead.'},
{id:'r22',from:'northlight',to:'project',label:'OPERATES',group:'professional',confidence:97,status:'supported',source:'NL-01 · Project brief',quote:'Northlight Labs operates the fictional Project Lumen research initiative.'},
];
export const events=[
{time:'09:00',title:'Participant record linked',detail:'Enrollment scope recorded',type:'Record',entity:'alex',relation:'r11'},
{time:'09:08',title:'Family declaration indexed',detail:'Mother and sibling relationships · REL-01',type:'Family',entity:'elena',relation:'r01'},
{time:'09:15',title:'Sibling claim corroborated',detail:'Two entries in the sample declaration',type:'Family',entity:'jamie',relation:'r02'},
{time:'09:24',title:'Friendship statement linked',detail:'Explicit participant statement · REL-02',type:'Social',entity:'rowan',relation:'r04'},
{time:'09:31',title:'Neighbor relation recorded',detail:'Declared relation · no address data',type:'Place',entity:'sam',relation:'r05'},
{time:'09:42',title:'Co-authorship verified',detail:'Both authors listed on DOC-04',type:'Professional',entity:'maya',relation:'r08'},
{time:'09:50',title:'Relationship conflict detected',detail:'Friendship claim disagrees with REL-05',type:'Review',entity:'maya',relation:'r09'},
{time:'10:03',title:'Interview date flagged',detail:'Conflicting sample publication dates',type:'Review',entity:'article',relation:'r12'},
{time:'10:16',title:'Project brief connected',detail:'Northlight → Project Lumen',type:'Professional',entity:'northlight',relation:'r22'},
{time:'10:27',title:'Test site registered',detail:'Designated simulation source CAM-01',type:'Place',entity:'studio',relation:'r18'},
{time:'10:39',title:'Session log reviewed',detail:'Synthetic observations · DOC-08',type:'Record',entity:'dataset',relation:'r19'},
{time:'10:48',title:'Evidence snapshot assembled',detail:'16 entities · 22 relationship claims',type:'Snapshot',entity:'alex',relation:'r07'},
];
export const cameras=[{id:'CAM-01',name:'Field station A',zone:'Designated test area A',status:'Synthetic scene',x:37,y:41},{id:'CAM-02',name:'Observation point B',zone:'Designated test area B',status:'Synthetic scene',x:62,y:57},{id:'CAM-03',name:'Field station C',zone:'Designated test area C',status:'Not connected',x:76,y:24}];
export function findPath(from:string,to:string,edges:Connection[]):string[]{
 const queue=[[from]];const seen=new Set([from]);
 while(queue.length){const path=queue.shift()!;const last=path[path.length-1];if(last===to)return path;for(const edge of edges){const next=edge.from===last?edge.to:edge.to===last?edge.from:null;if(next&&!seen.has(next)){seen.add(next);queue.push([...path,next]);}}}return [];
}
