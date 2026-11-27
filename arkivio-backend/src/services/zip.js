// Petit ZIP sans dépendance (méthode STORE), pour livrer le dossier de plans complet.
const TABLE = Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0})
const crc32 = b => {let c=0xffffffff;for(const x of b)c=TABLE[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0}

export function creerZip(fichiers) {
  const locals=[],centrales=[];let offset=0
  for(const f of fichiers){
    const safeName=String(f.nom).replace(/\\/g,'/').split('/').filter(p=>p&&p!=='.'&&p!=='..').map(p=>p.replace(/[:*?"<>|]/g,'_')).join('/')
    const name=Buffer.from(safeName,'utf8'),data=Buffer.isBuffer(f.donnees)?f.donnees:Buffer.from(f.donnees),crc=crc32(data)
    const local=Buffer.alloc(30+name.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(0x0800,6);local.writeUInt16LE(0,8);local.writeUInt16LE(0,10);local.writeUInt16LE(0,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(0,28);name.copy(local,30);locals.push(local,data)
    const central=Buffer.alloc(46+name.length);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(0x0800,8);central.writeUInt16LE(0,10);central.writeUInt16LE(0,12);central.writeUInt16LE(0,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);central.writeUInt32LE(0,38);central.writeUInt32LE(offset,42);name.copy(central,46);centrales.push(central);offset+=local.length+data.length
  }
  const centralSize=centrales.reduce((s,b)=>s+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(centrales.length,8);end.writeUInt16LE(centrales.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20)
  return Buffer.concat([...locals,...centrales,end])
}
