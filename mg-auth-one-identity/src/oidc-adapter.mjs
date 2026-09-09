export function databaseAdapter(prisma) {
  return class Adapter {
    constructor(model) { this.model = model; }
    async upsert(id, payload, expiresIn) {
      const data = { payload: JSON.parse(JSON.stringify(payload)), uid: payload.uid || null, userCode: payload.userCode || null,
        grantId: payload.grantId || null, expiresAt: new Date(Date.now() + (expiresIn || 86400) * 1000) };
      await prisma.oidcRecord.upsert({ where: { model_id: { model: this.model, id } }, create: { model: this.model, id, ...data }, update: data });
    }
    async read(where) {
      const row = await prisma.oidcRecord.findFirst({ where: { model: this.model, ...where, expiresAt: { gt: new Date() } } });
      return row ? { ...row.payload, ...(row.consumedAt ? { consumed: row.consumedAt } : {}) } : undefined;
    }
    find(id) { return this.read({ id }); }
    findByUid(uid) { return this.read({ uid }); }
    findByUserCode(userCode) { return this.read({ userCode }); }
    async consume(id) {
      const result = await prisma.oidcRecord.updateMany({ where: { model: this.model, id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: Math.floor(Date.now() / 1000) } });
      if (result.count !== 1) throw new Error('授权凭据已消费或过期');
    }
    async destroy(id) { await prisma.oidcRecord.deleteMany({ where: { model: this.model, id } }); }
    async revokeByGrantId(grantId) { await prisma.oidcRecord.deleteMany({ where: { grantId } }); }
  };
}
