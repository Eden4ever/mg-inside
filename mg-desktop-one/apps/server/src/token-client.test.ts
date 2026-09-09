import {expect,it} from 'vitest';
import {apiErrorMessage} from '../../../../mg-token-one/mg-gateway/apps/web/src/api/error-message';
it('Token 页面保留网关嵌套业务错误和出口平铺错误，未知响应使用网络提示',()=>{
 expect(apiErrorMessage({error:{message:'模型名已存在',status_code:400}},'HTTP 400')).toBe('模型名已存在');
 expect(apiErrorMessage({error:{message:['名称不能为空','分组不存在']}})).toBe('名称不能为空；分组不存在');
 expect(apiErrorMessage({message:'服务尚未启用'})).toBe('服务尚未启用');
 expect(apiErrorMessage({error:{message:{unexpected:true}}},'连接失败')).toBe('连接失败');
 expect(apiErrorMessage(undefined,'请求超时')).toBe('请求超时');
});
