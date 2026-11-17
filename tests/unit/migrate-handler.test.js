'use strict';

const { handler } = require('../../src/handlers/migrate');

describe('Lambda migrate', () => {
  test('aplica as migrations com a configuração do banco e devolve o log', async () => {
    const db = { host: 'aurora', user: 'fiapx_auth' };
    const migrar = jest.fn(async (_db, saida) => saida.log('migration aplicada: 001_create_users.sql'));
    const createConfig = () => ({ database: async () => db });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const r = await handler({}, {}, { createConfig, migrar });

    expect(migrar).toHaveBeenCalledWith(db, expect.any(Object));
    expect(r).toEqual({ ok: true, linhas: ['migration aplicada: 001_create_users.sql'] });
  });

  test('propaga o erro para a invocação falhar', async () => {
    const createConfig = () => ({ database: async () => ({}) });
    const migrar = jest.fn(async () => { throw new Error('sem conexão'); });
    await expect(handler({}, {}, { createConfig, migrar })).rejects.toThrow('sem conexão');
  });
});
