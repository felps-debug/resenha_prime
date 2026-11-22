-- A API anônima não precisa modificar tabelas; as demais operações continuam sob RLS.
revoke insert, update, delete on all tables in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
