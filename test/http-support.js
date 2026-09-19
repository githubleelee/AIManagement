import request from 'supertest';
import { buildApp } from '../src/app.js';
import { createTempDatabase, resetDatabase } from '../src/db/test-support.js';
import { issueToken } from '../src/auth/token.js';
import { hashPassword } from '../src/auth/password.js';
/** 测试用统一密码（明文）。工厂函数会用真实 scrypt 哈希写入。 */
export const TEST_PASSWORD = 'Test@12345';
export async function createHttpTestContext() {
    const tempDb = createTempDatabase();
    // 关键：把临时库注入 app，使其不读 dev.db 单例
    const app = buildApp({ logger: false, prisma: tempDb.prisma });
    // 注意：此处**不调用** app.ready()。
    // Fastify 一旦 booted 就不允许再注册路由（会抛 "Root plugin has already booted"），
    // 而调用方通常需要在 ready 之前注册自己的探针端点。
    // 因此把 ready 的责任交给调用方：注册完探针后再 await app.ready()。
    // supertest 在每次请求时（而非构造时）读取地址，因此 ready 晚于本函数是安全的。
    const asUser = (token) => {
        const st = request(app.server);
        const withAuth = (t) => {
            if (token)
                t.set('Authorization', `Bearer ${token}`);
            return t;
        };
        return {
            get: (url) => withAuth(st.get(url)),
            post: (url) => withAuth(st.post(url)),
            patch: (url) => withAuth(st.patch(url)),
            put: (url) => withAuth(st.put(url)),
            delete: (url) => withAuth(st.delete(url)),
        };
    };
    return {
        app,
        db: tempDb.prisma,
        reset: () => resetDatabase(tempDb.prisma),
        loginAs: (userId) => issueToken(userId),
        asUser,
        dispose: async () => {
            await app.close();
            await tempDb.dispose();
        },
    };
}
// ---------------------------------------------------------------------------
// 数据工厂（仅本骨架所需的最小集合）
//
// 契约「测试数据工厂」列出的 8 个函数属 T0.5 交付范围，由成员 2 / 成员 4 在
// 各自模块内使用时补齐。本文件只提供 HTTP 层测试自建数据所需的最小函数，
// **不覆盖、不替代** test/ 下可能出现的其它工厂定义。
// ---------------------------------------------------------------------------
/** 造一个用户（密码用真实 scrypt 哈希，便于将来接入端点 1 后可直接登录）。 */
export async function makeUser(db, account, displayName = account) {
    const user = await db.user.create({
        data: { account, displayName, passwordHash: await hashPassword(TEST_PASSWORD) },
        select: { id: true },
    });
    return user.id;
}
/** 造一个项目，并把 ownerUserId 设为该项目 PM（与端点 3 的副作用一致）。 */
export async function makeProject(db, ownerUserId, name = '测试项目') {
    const project = await db.project.create({
        data: {
            name,
            ownerUserId,
            members: { create: { userId: ownerUserId, role: 'PM' } },
        },
        select: { id: true },
    });
    return project.id;
}
/** 往项目里加成员并指定角色。 */
export async function makeMember(db, projectId, userId, role = 'MEMBER') {
    await db.projectMember.create({ data: { projectId, userId, role } });
}
//# sourceMappingURL=http-support.js.map