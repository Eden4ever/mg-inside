import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { DataSource } from 'typeorm'
import { User } from '../src/entities/user.entity'
import { applyIdentityUser } from '../src/modules/auth/identity-projection'

test('真实数据库：中心建号幂等、保留历史权限额度、冲突整批回滚', async () => {
  const database = `mg_identity_projection_${process.pid}_${Date.now()}`
  assert.match(database, /^mg_identity_projection_\d+_\d+$/)
  const connection = { host:process.env.DB_HOST || '127.0.0.1', port:Number(process.env.DB_PORT || 3306), user:process.env.DB_USERNAME || 'root', password:process.env.DB_PASSWORD || '' }
  const root = await mysql.createConnection(connection)
  let source: DataSource | undefined
  try {
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    source = await new DataSource({type:'mysql',host:connection.host,port:connection.port,username:connection.user,password:connection.password,database,entities:[User],synchronize:true}).initialize()
    const db = source
    const apply = (p:any) => db.transaction(manager=>applyIdentityUser(manager.getRepository(User),p))
    const profile = { subject:'central-new',localUserId:null,username:'central-new',name:'中心新员工',department:'研发',active:true,securityVersion:1 }
    const first = await apply(profile)
    assert.ok(first);assert.equal(first.role,'user');assert.equal(first.passwordHash,null)
    assert.equal((await apply(profile))!.id,first.id)
    assert.equal(await db.getRepository(User).count(),1)
    await db.getRepository(User).update(first.id,{role:'admin',fixedMonthlyQuota:500,quotaUsed:123,groupNames:['private']})
    const changed = await apply({...profile,username:'renamed',name:'新姓名',department:null,active:false})
    assert.equal(changed!.status,0);assert.equal(changed!.identityEnabled,false);assert.equal(changed!.username,'renamed')
    assert.equal(changed!.role,'admin');assert.equal(Number(changed!.fixedMonthlyQuota),500);assert.equal(Number(changed!.quotaUsed),123);assert.deepEqual(changed!.groupNames,['private'])
    assert.equal((await apply({...profile,active:true}))!.status,1)
    const legacy=await db.getRepository(User).save(db.getRepository(User).create({username:'old',displayName:'历史员工',role:'admin',quotaUsed:42}))
    await assert.rejects(apply({...profile,subject:'legacy',username:'new-legacy',name:'历史员工'}),/同名/)
    const migrated=await apply({...profile,subject:'legacy',localUserId:String(legacy.id),username:'new-legacy',name:'历史员工'})
    assert.equal(migrated!.id,legacy.id);assert.equal(migrated!.role,'admin');assert.equal(Number(migrated!.quotaUsed),42)
    await assert.rejects(apply({...profile,subject:'attacker',localUserId:String(legacy.id)}),/覆盖/)
    await assert.rejects(db.transaction(async manager=>{
      await applyIdentityUser(manager.getRepository(User),{...profile,name:'不应保留的姓名'})
      await applyIdentityUser(manager.getRepository(User),{...profile,subject:'conflict',username:'old',name:'历史员工'})
    }))
    assert.equal((await db.getRepository(User).findOneByOrFail({id:first.id})).displayName,profile.name)
    const concurrent=await Promise.allSettled([apply({...profile,subject:'concurrent',username:'concurrent',name:'并发员工'}),apply({...profile,subject:'concurrent',username:'concurrent',name:'并发员工'})])
    assert.ok(concurrent.some(result=>result.status==='fulfilled'))
    assert.equal(await db.getRepository(User).countBy({identitySubject:'concurrent'}),1)
  } finally {
    if(source?.isInitialized) await source.destroy()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``);await root.end()
  }
})
