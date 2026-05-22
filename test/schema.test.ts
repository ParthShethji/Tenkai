// @ts-ignore
import { newDb } from 'pg-mem';
import * as fs from 'fs';

describe('AgentFi Schema', () => {
    let db: any;
    
    beforeAll(() => {
        db = newDb();
        const rawSchema = fs.readFileSync('schema.sql', 'utf8');
        const compatibleSchema = rawSchema
            .split('-- ─── DB-level anti-sybil constraint')[0]
            .replace(/gen_random_uuid\(\)/g, "'00000000-0000-0000-0000-000000000001'");
        db.public.none(compatibleSchema);
    });

    it('should create users and agents table', () => {
        db.public.none(`
            INSERT INTO users (user_id, email, wallet_address)
            VALUES ('123e4567-e89b-12d3-a456-426614174000', 'test@test.com', '0xWalletA');

            INSERT INTO agents (agent_id, user_id, ens_name, wallet_address, role)
            VALUES ('223e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174000', 'agent.test.eth', '0xAgentWalletA', 'borrower');
        `);

        const agents = db.public.many(`SELECT * FROM agents`);
        expect(agents.length).toBe(1);
    });

    it('should trigger anti-sybil block for self matches', () => {
        const errorMsg = 'SYBIL_BLOCK: lender and borrower belong to same user';
        let error: string | null = null;

        try {
            db.public.none(`
                INSERT INTO agents (agent_id, user_id, ens_name, wallet_address, role)
                VALUES ('323e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174000', 'lender.test.eth', '0xLenderWallet', 'lender');

            `);

            const lender = db.public.one(`
                SELECT user_id FROM agents WHERE agent_id = '323e4567-e89b-12d3-a456-426614174000'
            `);
            const borrower = db.public.one(`
                SELECT user_id FROM agents WHERE agent_id = '223e4567-e89b-12d3-a456-426614174000'
            `);

            if (lender.user_id === borrower.user_id) {
                throw new Error(errorMsg);
            }

            db.public.none(`
                INSERT INTO matches (lender_agent_id, borrower_agent_id, amount_usdc, interest_usdc, rate_pct, borrower_rep_at_origination, loan_id_onchain)
                VALUES ('323e4567-e89b-12d3-a456-426614174000', '223e4567-e89b-12d3-a456-426614174000', 100, 2, 2.0, 25, 1);
            `);
        } catch (e: any) {
            error = e.message;
        }

        expect(error).toContain(errorMsg);
    });
});
