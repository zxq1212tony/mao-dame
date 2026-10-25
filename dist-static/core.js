export const TYPES = [
  {id:'facade',name:'立面与造型',short:'立面',subtitle:'节奏、分格与构件',color:'#454545',tags:['竖向节奏','细密分格','深窗框','水平遮阳','扭转体量'],region:'塔楼立面'},
  {id:'glass',name:'玻璃与材料',short:'材料',subtitle:'透光、反射与纹理',color:'#707070',tags:['中性灰','高透光','柔和反射','强镜面','暖色金属'],region:'塔楼幕墙'},
  {id:'mood',name:'光照与氛围',short:'氛围',subtitle:'天空、光线与色温',color:'#929292',tags:['柔和日景','阴天漫射','黄昏暖光','强烈夕阳阴影','低饱和'],region:'全图'},
  {id:'plants',name:'植物与景观',short:'景观',subtitle:'种植、尺度与疏密',color:'#606060',tags:['疏朗乔木','低矮灌木','自然草地','密集植被','保留入口'],region:'前景景观'}
];
export const REGIONS=['塔楼立面','塔楼幕墙','建筑冠部','裙房与入口','前景景观','全图'];
export function initialState(){return {version:1,name:'我的高层方案',use:'办公建筑',height:'',mode:'preserve',locks:{mass:true,camera:true,site:true},base:null,result:null,anchors:TYPES.map(t=>({id:t.id,image:null,tags:[],note:'',region:t.region,strength:'适度借鉴',rect:null})),checks:{mass:false,camera:false,facade:false,material:false,site:false},revision:'',savedAt:null};}
const clean=(v,n=300)=>String(v??'').slice(0,n);
function imageValue(v){if(v===null||v===undefined)return null;if(!v||typeof v!=='object'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.data??'')||v.data.length>12000000)throw Error('方案中有不支持的图片数据');if(!Number.isFinite(v.width)||!Number.isFinite(v.height)||v.width<=0||v.height<=0)throw Error('图片尺寸无效');return {data:v.data,name:clean(v.name,120),width:v.width,height:v.height};}
export function normalizeState(raw){
  if(!raw||raw.version!==1||!Array.isArray(raw.anchors))throw Error('这不是支持的锚点方案文件');
  const s=initialState();s.name=clean(raw.name,80);s.use=clean(raw.use,50);s.height=clean(raw.height,20);s.mode=raw.mode==='explore'?'explore':'preserve';
  for(const k of Object.keys(s.locks))s.locks[k]=typeof raw.locks?.[k]==='boolean'?raw.locks[k]:true;
  s.base=imageValue(raw.base);s.result=imageValue(raw.result);s.revision=clean(raw.revision,1200);
  s.anchors=s.anchors.map(a=>{const v=raw.anchors.find(x=>x?.id===a.id);if(!v)return a;a.image=imageValue(v.image);a.tags=Array.isArray(v.tags)?v.tags.slice(0,12).map(x=>clean(x,30)):[];a.note=clean(v.note,500);a.region=REGIONS.includes(v.region)?v.region:a.region;a.strength=['适度借鉴','接近参考'].includes(v.strength)?v.strength:'适度借鉴';if(v.rect&&['x','y','w','h'].every(k=>Number.isFinite(v.rect[k]))){const {x,y,w,h}=v.rect;if(x>=0&&y>=0&&w>0&&h>0&&x+w<=1.001&&y+h<=1.001)a.rect={x,y,w:Math.min(w,1-x),h:Math.min(h,1-y)};}return a;});
  for(const k of Object.keys(s.checks))s.checks[k]=raw.checks?.[k]===true;s.savedAt=typeof raw.savedAt==='string'?clean(raw.savedAt,60):null;return s;
}
export function issues(s){const all=[];const a=id=>s.anchors.find(x=>x.id===id);const has=(id,re)=>re.test([...a(id).tags,a(id).note].join(' '));
  if(!s.base)all.push({level:'block',title:'请先上传你的白模',detail:'当前画布是操作示意图，不能作为你的项目输入。',action:'base'});
  if(s.locks.mass&&has('facade',/扭转体量|改变轮廓|退台体量/))all.push({level:'block',title:'体量约束与造型意图冲突',detail:'你要求保留体量，同时选择了改变体量的特征。请修改立面标签，或进入体量探索并取消体量保留。',action:'facade'});
  if(has('glass',/高透光/)&&has('glass',/强镜面/))all.push({level:'warn',title:'玻璃的视觉重点需要明确',detail:'高透光与强镜面会竞争画面表达；请选择本轮更重要的一项。',action:'glass'});
  if(has('mood',/阴天/)&&has('mood',/夕阳阴影/))all.push({level:'block',title:'光照条件冲突',detail:'阴天漫射与强烈夕阳阴影同时出现，请保留一种光照条件。',action:'mood'});
  if(s.mode==='preserve'&&!s.locks.mass)all.push({level:'warn',title:'保形任务没有保留体量',detail:'建议启用体量保留，或将任务改为体量探索。',action:'setup'});
  if(!s.anchors.some(x=>x.image))all.push({level:'warn',title:'还没有上传参考图片',detail:'可以先整理文字说明；要验证多图锚点方法，请补充至少一张参考。',action:'facade'});
  for(const anchor of s.anchors)if(anchor.image&&!anchor.tags.length&&!anchor.note.trim())all.push({level:'warn',title:`${TYPES.find(t=>t.id===anchor.id).short}参考缺少用途`,detail:'选择借鉴标签，或写一句希望参考的内容。',action:anchor.id});
  if(s.mode==='explore')all.push({level:'info',title:'体量探索需要回写模型',detail:'效果图确认后，应把几何变化落实到 Rhino，再检查其他视角。',action:'setup'});
  return all;
}
export function compatibleImages(s){return !s.base||!s.result||Math.abs(s.base.width/s.base.height-s.result.width/s.result.height)<0.01;}
export function buildBrief(s){const locks=[s.locks.mass?'建筑数量、位置、高度比例与主体轮廓':null,s.locks.camera?'相机视角、透视、画幅与构图':null,s.locks.site?'道路、周边建筑及场地关系':null].filter(Boolean);
  let n=1;const lines=[`项目：${s.name||'未命名方案'}`,`任务：${s.mode==='preserve'?'白模保形效果图':'指定部位的体量探索'}；${s.use}${s.height?`，大致高度 ${s.height} 米`:''}。`,'',s.base?`图 ${n++}：白模底图（${s.base.name}），作为空间与相机依据。`:'白模底图：尚未上传。',`必须保持：${locks.join('；')||'按下述可改范围执行'}。`,''];
  for(const t of TYPES){const a=s.anchors.find(x=>x.id===t.id);if(!a.image&&!a.tags.length&&!a.note.trim())continue;lines.push(`${a.image?`图 ${n++}（${a.image.name}）`:'文字设定'}：${t.name}；作用于 ${a.region}${a.rect?`，框选区域 x=${Math.round(a.rect.x*100)}%、y=${Math.round(a.rect.y*100)}%、宽=${Math.round(a.rect.w*100)}%、高=${Math.round(a.rect.h*100)}%`:''}。`,`只借鉴：${[...a.tags,a.note].filter(Boolean).join('；')||'用途待补充'}。参考程度：${a.strength}。`);}
  lines.push('','材料参考提供质感，光照参考统一全图光线。不要直接复制参考图的建筑轮廓、道路与背景。','确保立面转角连续、裙房连接合理、植物及人物尺度可信。输出清晰的建筑效果图，不添加文字或水印。','先核对几何、视角与场地，再评价材料和氛围。');return lines.join('\n');
}
