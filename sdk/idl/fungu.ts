/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/fungu.json`.
 */
export type Fungu = {
  "address": "6NtCwcAU57GGeLCKQcJCgnk9Nzu9892jdQFDUaM2T4bE",
  "metadata": {
    "name": "fungu",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Fungu: on-chain ledger for debts between friends and for chamas"
  },
  "instructions": [
    {
      "name": "acceptAgreement",
      "docs": [
        "The borrower agrees to the exact terms (the hash must match what they saw)."
      ],
      "discriminator": [
        69,
        99,
        1,
        250,
        152,
        135,
        196,
        160
      ],
      "accounts": [
        {
          "name": "borrower",
          "signer": true,
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "agreement",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "cancelAgreement",
      "docs": [
        "The lender withdraws a proposal the borrower has not accepted yet."
      ],
      "discriminator": [
        75,
        89,
        85,
        4,
        100,
        216,
        143,
        37
      ],
      "accounts": [
        {
          "name": "lender",
          "signer": true,
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "agreement",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "confirmOffchainRepayment",
      "docs": [
        "The lender confirms a repayment received off-chain (cash or mobile",
        "money). Only the lender can sign this, so a borrower can never claim",
        "a payment that the lender didn't receive. `receipt_hash` lets the app prove which",
        "mobile-money receipt it was without putting the receipt on-chain."
      ],
      "discriminator": [
        189,
        105,
        7,
        124,
        18,
        173,
        122,
        4
      ],
      "accounts": [
        {
          "name": "lender",
          "signer": true,
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "agreement",
          "writable": true
        },
        {
          "name": "borrowerProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "agreement.borrower",
                "account": "agreement"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "receiptHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "contribute",
      "docs": [
        "Pay this round's contribution into the pot."
      ],
      "discriminator": [
        82,
        33,
        68,
        131,
        32,
        0,
        205,
        95
      ],
      "accounts": [
        {
          "name": "member",
          "signer": true
        },
        {
          "name": "chama",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "chama"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "chama"
          ]
        },
        {
          "name": "memberAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createAgreement",
      "docs": [
        "The lender proposes a debt. Nothing moves until the borrower accepts."
      ],
      "discriminator": [
        220,
        156,
        65,
        172,
        252,
        68,
        74,
        233
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "lender",
          "signer": true
        },
        {
          "name": "borrower"
        },
        {
          "name": "mint"
        },
        {
          "name": "agreement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  114,
                  101,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lender"
              },
              {
                "kind": "account",
                "path": "borrower"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "principal",
          "type": "u64"
        },
        {
          "name": "dueTs",
          "type": "i64"
        },
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "guarantor",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "createChama",
      "docs": [
        "Start a chama: a fixed contribution each round, a rotating payout in",
        "join order, and a refundable bond each member stakes against missing",
        "a contribution after their own payout."
      ],
      "discriminator": [
        190,
        131,
        118,
        241,
        255,
        53,
        138,
        101
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "creator",
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "chama",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  109,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "chama"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "contribution",
          "type": "u64"
        },
        {
          "name": "periodSecs",
          "type": "i64"
        },
        {
          "name": "maxMembers",
          "type": "u8"
        },
        {
          "name": "bond",
          "type": "u64"
        }
      ]
    },
    {
      "name": "forgive",
      "docs": [
        "The lender forgives whatever is left. Nothing negative is recorded",
        "on the borrower's profile."
      ],
      "discriminator": [
        108,
        41,
        194,
        58,
        45,
        178,
        32,
        41
      ],
      "accounts": [
        {
          "name": "lender",
          "signer": true,
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "agreement",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "fundAgreement",
      "docs": [
        "Optional: the lender sends the principal on-chain, wallet to wallet.",
        "(The money can also change hands off-chain, e.g. by mobile money.)"
      ],
      "discriminator": [
        107,
        79,
        10,
        20,
        10,
        243,
        34,
        18
      ],
      "accounts": [
        {
          "name": "lender",
          "signer": true,
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "agreement",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "lenderAta",
          "writable": true
        },
        {
          "name": "borrowerAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "guarantorCosign",
      "docs": [
        "The named guarantor co-signs, seeing the same terms."
      ],
      "discriminator": [
        190,
        62,
        167,
        180,
        175,
        148,
        110,
        131
      ],
      "accounts": [
        {
          "name": "guarantor",
          "signer": true
        },
        {
          "name": "agreement",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "initProfile",
      "docs": [
        "One reputation record per wallet: counts of settled, on-time and late",
        "debts and completed chama cycles. Not a credit score; anyone can read it."
      ],
      "discriminator": [
        210,
        162,
        212,
        95,
        95,
        186,
        89,
        119
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinChama",
      "docs": [
        "Join while the chama is forming, staking the bond. The payout order is",
        "the join order. When the chama is full, round 1 starts."
      ],
      "discriminator": [
        230,
        86,
        65,
        98,
        5,
        151,
        243,
        223
      ],
      "accounts": [
        {
          "name": "member",
          "signer": true
        },
        {
          "name": "chama",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "chama"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "chama"
          ]
        },
        {
          "name": "memberAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "leaveChama",
      "docs": [
        "Leave before the chama starts; the bond comes straight back."
      ],
      "discriminator": [
        192,
        209,
        227,
        110,
        149,
        180,
        240,
        255
      ],
      "accounts": [
        {
          "name": "member",
          "signer": true
        },
        {
          "name": "chama",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "chama"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "chama"
          ]
        },
        {
          "name": "memberAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "markOverdue",
      "docs": [
        "Anyone can flag a debt as overdue once its due date passes. It is",
        "only a flag: no fees, no penalties."
      ],
      "discriminator": [
        178,
        135,
        117,
        229,
        133,
        152,
        175,
        27
      ],
      "accounts": [
        {
          "name": "agreement",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "payout",
      "docs": [
        "Anyone can trigger the payout once every member has paid, or once the",
        "round's time is up. A member who missed the round is covered from",
        "their own bond and the miss is recorded. The pot goes to this round's",
        "member in join order."
      ],
      "discriminator": [
        149,
        140,
        194,
        236,
        174,
        189,
        6,
        239
      ],
      "accounts": [
        {
          "name": "chama",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "chama"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "chama"
          ]
        },
        {
          "name": "recipientAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "repay",
      "docs": [
        "The borrower repays part or all of what is left, wallet to wallet."
      ],
      "discriminator": [
        234,
        103,
        67,
        82,
        208,
        234,
        219,
        166
      ],
      "accounts": [
        {
          "name": "borrower",
          "signer": true,
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "agreement",
          "writable": true
        },
        {
          "name": "borrowerProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "borrower"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "agreement"
          ]
        },
        {
          "name": "borrowerAta",
          "writable": true
        },
        {
          "name": "lenderAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawBond",
      "docs": [
        "After the last round, each member takes back what is left of their bond",
        "and the cycle is written to their profile."
      ],
      "discriminator": [
        222,
        199,
        141,
        31,
        188,
        93,
        155,
        40
      ],
      "accounts": [
        {
          "name": "member",
          "signer": true
        },
        {
          "name": "chama",
          "writable": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "member"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "chama"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "chama"
          ]
        },
        {
          "name": "memberAta",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "agreement",
      "discriminator": [
        83,
        212,
        5,
        110,
        225,
        249,
        197,
        84
      ]
    },
    {
      "name": "chama",
      "discriminator": [
        92,
        211,
        237,
        100,
        10,
        157,
        139,
        147
      ]
    },
    {
      "name": "profile",
      "discriminator": [
        184,
        101,
        165,
        188,
        95,
        63,
        127,
        188
      ]
    }
  ],
  "events": [
    {
      "name": "agreementEvent",
      "discriminator": [
        237,
        18,
        184,
        9,
        113,
        29,
        59,
        172
      ]
    },
    {
      "name": "chamaEvent",
      "discriminator": [
        69,
        87,
        252,
        98,
        79,
        159,
        31,
        164
      ]
    },
    {
      "name": "receiptEvent",
      "discriminator": [
        213,
        73,
        173,
        31,
        69,
        67,
        164,
        0
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be more than zero"
    },
    {
      "code": 6001,
      "name": "dueInPast",
      "msg": "The due date must be in the future"
    },
    {
      "code": 6002,
      "name": "selfAgreement",
      "msg": "Lender and borrower must be different people"
    },
    {
      "code": 6003,
      "name": "selfGuarantee",
      "msg": "The guarantor must be someone other than the lender or borrower"
    },
    {
      "code": 6004,
      "name": "wrongStatus",
      "msg": "Not allowed in the current status"
    },
    {
      "code": 6005,
      "name": "termsMismatch",
      "msg": "The terms you signed don't match this agreement"
    },
    {
      "code": 6006,
      "name": "notGuarantor",
      "msg": "Only the named guarantor can sign"
    },
    {
      "code": 6007,
      "name": "alreadyFunded",
      "msg": "Already funded"
    },
    {
      "code": 6008,
      "name": "overpayment",
      "msg": "That's more than what is left to repay"
    },
    {
      "code": 6009,
      "name": "notYetDue",
      "msg": "Not due yet"
    },
    {
      "code": 6010,
      "name": "wrongOwner",
      "msg": "Token account belongs to someone else"
    },
    {
      "code": 6011,
      "name": "nameTooLong",
      "msg": "Chama name is too long (32 characters max)"
    },
    {
      "code": 6012,
      "name": "periodTooShort",
      "msg": "A round must be at least 60 seconds"
    },
    {
      "code": 6013,
      "name": "badMemberCount",
      "msg": "A chama needs 2 to 12 members"
    },
    {
      "code": 6014,
      "name": "alreadyMember",
      "msg": "Already a member"
    },
    {
      "code": 6015,
      "name": "chamaFull",
      "msg": "The chama is full"
    },
    {
      "code": 6016,
      "name": "notMember",
      "msg": "Not a member of this chama"
    },
    {
      "code": 6017,
      "name": "alreadyPaid",
      "msg": "Already paid this round"
    },
    {
      "code": 6018,
      "name": "roundNotOver",
      "msg": "The round isn't over and not everyone has paid"
    },
    {
      "code": 6019,
      "name": "alreadyWithdrawn",
      "msg": "Bond already withdrawn"
    }
  ],
  "types": [
    {
      "name": "agreement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "lender",
            "type": "pubkey"
          },
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "guarantor",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "guarantorSigned",
            "type": "bool"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "repaid",
            "type": "u64"
          },
          {
            "name": "dueTs",
            "type": "i64"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "agreementStatus"
              }
            }
          },
          {
            "name": "funded",
            "type": "bool"
          },
          {
            "name": "overdue",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "closedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "agreementEvent",
      "docs": [
        "kind: 0 created, 1 accepted, 2 cancelled, 3 guarantor signed, 4 funded,",
        "5 repaid on-chain, 6 repaid off-chain (lender confirmed), 7 overdue,",
        "8 forgiven, 9 settled"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "agreement",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "agreementStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "proposed"
          },
          {
            "name": "active"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "forgiven"
          }
        ]
      }
    },
    {
      "name": "chama",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "contribution",
            "type": "u64"
          },
          {
            "name": "periodSecs",
            "type": "i64"
          },
          {
            "name": "maxMembers",
            "type": "u8"
          },
          {
            "name": "bond",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "chamaStatus"
              }
            }
          },
          {
            "name": "round",
            "type": "u8"
          },
          {
            "name": "roundStart",
            "type": "i64"
          },
          {
            "name": "paidMask",
            "type": "u16"
          },
          {
            "name": "members",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bonds",
            "type": {
              "vec": "u64"
            }
          },
          {
            "name": "defaults",
            "type": "bytes"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "chamaEvent",
      "docs": [
        "kind: 0 created, 1 joined, 2 left, 3 contributed, 4 payout, 5 bond withdrawn"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "chama",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "member",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "chamaStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "forming"
          },
          {
            "name": "active"
          },
          {
            "name": "completed"
          }
        ]
      }
    },
    {
      "name": "profile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "settled",
            "type": "u32"
          },
          {
            "name": "onTime",
            "type": "u32"
          },
          {
            "name": "late",
            "type": "u32"
          },
          {
            "name": "chamaCycles",
            "type": "u32"
          },
          {
            "name": "chamaMissed",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "receiptEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "agreement",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "receiptHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};
