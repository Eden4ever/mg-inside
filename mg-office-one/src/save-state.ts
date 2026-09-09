// 修改序号只在本地比较，保存完成以服务端签名回调的请求标识为准。
export class SaveState {
  revision = 0;
  pending = false;
  dirty = false;
  changed(pending: boolean) {
    this.pending = pending;
    if (pending) { this.revision++; this.dirty = true; }
  }
  confirm(revision: number, requestId: string, savedRequests: string[]) {
    if (!savedRequests.includes(requestId)) return false;
    if (!this.pending && this.revision === revision) this.dirty = false;
    return true;
  }
}
