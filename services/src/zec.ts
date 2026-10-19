// Which Zcash network the parties run on (the party services' ZAFE_NETWORK), and what a
// shielded unified address looks like there.
export const ZEC_NETWORK = (process.env.ZAFE_NETWORK ?? "regtest") as "regtest" | "test" | "main";
export const ZEC_PREFIX = { regtest: "uregtest1", test: "utest1", main: "u1" }[ZEC_NETWORK];
export const ZEC_ADDRESS = new RegExp(`^${ZEC_PREFIX}[02-9ac-hj-np-z]{20,400}$`);
