import re

with open('contracts/remittance_nft/src/test.rs', 'r') as f:
    content = f.read()

# Fix swapped arguments in admin_remint and try_admin_remint
# From:
#         &create_test_commitment(&env, 1),
#         &create_test_uri(&env),
# To:
#         &create_test_uri(&env),
#         &create_test_commitment(&env, 1),
content = re.sub(
    r'(&create_test_commitment\(&env,\s*\d+\),)\n(\s*)&create_test_uri\(&env\),',
    r'&create_test_uri(&env),\n\2\1',
    content
)

# Fix e.1.get(0).unwrap() == Symbol::new(&env, "Mint")
# To: Symbol::from_val(&env, &e.1.get(0).unwrap()) == Symbol::new(&env, "Mint")
content = content.replace(
    'e.1.get(0).unwrap() == Symbol::new(&env, "Mint")',
    'e.1.get(0).unwrap() == Symbol::new(&env, "Mint").into_val(&env)'
)

# Fix assert_eq!(mint_event.2, (500u32, commitment).into_val(&env));
# To:
# let data: (u32, BytesN<32>) = mint_event.2.clone().into_val(&env);
# assert_eq!(data, (500u32, commitment));
content = content.replace(
    'assert_eq!(mint_event.2, (500u32, commitment).into_val(&env));',
    'let data: (u32, BytesN<32>) = mint_event.2.clone().into_val(&env);\n    assert_eq!(data, (500u32, commitment));'
)
# Just in case clone isn't needed, try without clone first if Val is Copy? Val is actually Copy.
content = content.replace(
    'mint_event.2.clone().into_val(&env);',
    'mint_event.2.into_val(&env);'
)

with open('contracts/remittance_nft/src/test.rs', 'w') as f:
    f.write(content)

