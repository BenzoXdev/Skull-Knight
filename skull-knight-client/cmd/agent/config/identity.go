package config

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"log"

	"golang.org/x/crypto/hkdf"
)

type Identity struct {
	PublicKey   ed25519.PublicKey
	PrivateKey  ed25519.PrivateKey
	Fingerprint string // hex SHA256 of public key
}

func DeriveIdentity() Identity {
	hwid := deriveHWID()
	machineID := platformMachineID()
	if machineID == "" {
		log.Printf("[identity] WARNING: no OS-specific machine ID available, using HWID-only derivation")
		machineID = hwid
	}

	hkdfReader := hkdf.New(sha256.New, []byte(machineID), []byte(hwid), []byte("skull-knight-identity"))
	seed := make([]byte, ed25519.SeedSize)
	if _, err := io.ReadFull(hkdfReader, seed); err != nil {
		log.Fatalf("[identity] HKDF derivation failed: %v", err)
	}

	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)

	fp := sha256.Sum256(publicKey)

	return Identity{
		PublicKey:   publicKey,
		PrivateKey:  privateKey,
		Fingerprint: hex.EncodeToString(fp[:]),
	}
}

func (id *Identity) Sign(data []byte) []byte {
	return ed25519.Sign(id.PrivateKey, data)
}

func (id *Identity) PublicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(id.PublicKey)
}
