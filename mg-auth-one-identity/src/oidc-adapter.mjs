export function databaseAdapter(prisma, clients) {
  return class Adapter {
    constructor(model) { this.model = model; }
    async upsert(id, payload, expiresIn) {
      if (this.model === 'Client') throw new Error('客户端仅允许通过受控管理接口登记');
      const clientId = payload.clientId || null;
      const registered = clientId && clients ? await clients.row(clientId) : null;
      const data = { payload: JSON.parse(JSON.stringify(payload)), uid: payload.uid || null, userCode: payload.userCode || null,
        clientId, clientRevision: registered?.revision ?? null,
        grantId: payload.grantId || null, expiresAt: new Date(Date.now() + (expiresIn || 86400) * 1000) };
      await prisma.oidcRecord.upsert({ where: { model_id: { model: this.model, id } }, create: { model: this.model, id, ...data }, update: data });
    }
    async read(where) {
      const row = await prisma.oidcRecord.findFirst({ where: { model: this.model, ...where, expiresAt: { gt: new Date() } } });
      if (row?.clientId && clients) {
        if (!await clients.find(row.clientId)) return undefined;
        const registered = await clients.row(row.clientId);
        if (row.clientRevision !== null && registered?.revision !== row.clientRevision) return undefined;
      }
      return row ? { ...row.payload, ...(row.consumedAt ? { consumed: row.consumedAt } : {}) } : undefined;
    }
    find(id) { return this.model === 'Client' ? clients?.find(id) : this.read({ id }); }
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
