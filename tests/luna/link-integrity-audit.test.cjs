const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('read-only relationship audit distinguishes candidates without relinking or deleting',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create table nas_directory(drive text,path text,type text);
   create table luna_links(id integer,from_id text,status text,from_type text,kind text);`);
  const files=[['T','Current/Report.pdf','file'],['T','A/common.pdf','file'],['T','B/common.pdf','file'],['P','Partner/cross.pdf','file'],['T','folder-only.pdf','folder']];
  for(const values of files)await db.query('insert into nas_directory values($1,$2,$3)',values);
  const links=[
   [1,'t:\\current\\REPORT.pdf','active'], // normalized exact match
   [2,'T:/Old/report.pdf','active'], // one same-drive filename candidate
   [3,'T:/Old/common.pdf','active'], // ambiguous same-drive filename
   [4,'T:/Old/cross.pdf','active'], // other drive only
   [5,'T:/Old/absent.pdf','active'],
   [6,'T:/folder-only.pdf','active'], // valid folder bundle membership must not be reported missing
   [7,'T:/Old/ignored.pdf','pending'],[8,'T:/Old/rejected.pdf','rejected']
  ];
  for(const [id,p,status] of links)await db.query("insert into luna_links values($1,$2,$3,'nas_path','belongs')",[id,p,status]);
  const before=(await db.query('select * from luna_links order by id')).rows;
  await db.exec('begin read only');
  const result=await db.query(fs.readFileSync(path.join(__dirname,'../../scripts/sql/classify-luna-link-integrity.sql'),'utf8'));
  await db.exec('commit');
  assert.deepEqual(Object.fromEntries(result.rows.map(r=>[r.classification,r.link_count])),{
   ambiguous_same_drive_name:1,no_name_candidate:1,other_drive_name_candidate:1,same_drive_name_candidate:1
  });
  assert.deepEqual((await db.query('select * from luna_links order by id')).rows,before);
 } finally {await db.close();}
});
