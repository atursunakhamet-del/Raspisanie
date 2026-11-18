import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function localDatabase(file,migrationsDirectory){
 const sqlite=new DatabaseSync(file);sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
 sqlite.exec('CREATE TABLE IF NOT EXISTS _oqu_migrations (name TEXT PRIMARY KEY)');
 for(const name of readdirSync(migrationsDirectory).filter(n=>n.endsWith('.sql')).sort())if(!sqlite.prepare('SELECT name FROM _oqu_migrations WHERE name=?').get(name)){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(join(migrationsDirectory,name),'utf8').replaceAll('--> statement-breakpoint',''));sqlite.prepare('INSERT INTO _oqu_migrations (name) VALUES (?)').run(name);sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}
 }
 const statement=(sql,values=[])=>({bind(...next){return statement(sql,next);},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},runSync(){const result=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};},async run(){return this.runSync();}});
 return {prepare:sql=>statement(sql),async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.runSync());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
