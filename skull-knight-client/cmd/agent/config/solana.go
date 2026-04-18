package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

const solanaMemoProgramID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"

type rpcRequest struct {
	Jsonrpc string        `json:"jsonrpc"`
	ID      int           `json:"id"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
}

type signatureInfo struct {
	Signature string      `json:"signature"`
	Err       interface{} `json:"err"`
}

type signaturesResponse struct {
	Result []signatureInfo `json:"result"`
	Error  *rpcError       `json:"error"`
}

type rpcError struct {
	Code    json.Number `json:"code"`
	Message string      `json:"message"`
}

type transactionResponse struct {
	Result *transactionResult `json:"result"`
	Error  *rpcError          `json:"error"`
}

type transactionResult struct {
	Transaction parsedTransaction `json:"transaction"`
}

type parsedTransaction struct {
	Message parsedMessage `json:"message"`
}

type parsedMessage struct {
	Instructions []parsedInstruction `json:"instructions"`
}

type parsedInstruction struct {
	ProgramId string      `json:"programId"`
	Parsed    interface{} `json:"parsed"`
	Program   string      `json:"program"`
}

func LoadServerURLsFromSolana(solAddress, agentToken string, rpcEndpoints []string) ([]string, error) {
	if solAddress == "" {
		return nil, fmt.Errorf("solana address is empty")
	}
	if agentToken == "" {
		return nil, fmt.Errorf("agent token required for solana memo decryption")
	}
	if len(rpcEndpoints) == 0 {
		return nil, fmt.Errorf("no solana RPC endpoints configured")
	}

	client := &http.Client{Timeout: 15 * time.Second}

	keyHash := sha256.Sum256([]byte(agentToken))
	log.Printf("[solana] using key hash prefix: %x (token len=%d)", keyHash[:4], len(agentToken))

	var signatures []signatureInfo
	var lastErr error
	for i, endpoint := range rpcEndpoints {
		if i > 0 {
			time.Sleep(200 * time.Millisecond)
		}
		sigs, err := getSignatures(client, endpoint, solAddress)
		if err != nil {
			lastErr = err
			log.Printf("[solana] RPC %s failed for getSignatures: %v", endpoint, err)
			continue
		}
		signatures = sigs
		break
	}
	if signatures == nil {
		return nil, fmt.Errorf("all RPC endpoints failed for getSignatures: %v", lastErr)
	}

	if len(signatures) == 0 {
		return nil, fmt.Errorf("no transactions found for address %s", solAddress)
	}

	for _, sig := range signatures {
		if sig.Err != nil {
			continue
		}

		for j, endpoint := range rpcEndpoints {
			if j > 0 {
				time.Sleep(200 * time.Millisecond)
			}
			memo, err := getMemoFromTransaction(client, endpoint, sig.Signature)
			if err != nil {
				log.Printf("[solana] RPC %s failed for tx %s: %v", endpoint, sig.Signature[:16], err)
				continue
			}
			if memo == "" {
				break
			}

			decrypted, err := decryptMemo(memo, agentToken)
			if err != nil {
				log.Printf("[solana] failed to decrypt memo from tx %s: %v", sig.Signature[:16], err)
				break
			}

			urls := parseMemoURLs(decrypted)
			if len(urls) > 0 {
				log.Printf("[solana] resolved %d server URL(s) from memo in tx %s", len(urls), sig.Signature[:16])
				return urls, nil
			}
			break
		}
	}

	return nil, fmt.Errorf("no valid decryptable memo found in recent transactions")
}

func getSignatures(client *http.Client, endpoint, address string) ([]signatureInfo, error) {
	reqBody := rpcRequest{
		Jsonrpc: "2.0",
		ID:      1,
		Method:  "getSignaturesForAddress",
		Params: []interface{}{
			address,
			map[string]interface{}{"limit": 10},
		},
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	resp, err := client.Post(endpoint, "application/json", strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result signaturesResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse signatures response: %v", err)
	}

	if result.Error != nil {
		return nil, fmt.Errorf("RPC error %s: %s", result.Error.Code.String(), result.Error.Message)
	}

	return result.Result, nil
}

func getMemoFromTransaction(client *http.Client, endpoint, signature string) (string, error) {
	reqBody := rpcRequest{
		Jsonrpc: "2.0",
		ID:      1,
		Method:  "getTransaction",
		Params: []interface{}{
			signature,
			map[string]interface{}{
				"encoding":                       "jsonParsed",
				"maxSupportedTransactionVersion": 0,
			},
		},
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	resp, err := client.Post(endpoint, "application/json", strings.NewReader(string(data)))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result transactionResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("failed to parse transaction response: %v", err)
	}

	if result.Error != nil {
		return "", fmt.Errorf("RPC error %s: %s", result.Error.Code.String(), result.Error.Message)
	}

	if result.Result == nil {
		return "", fmt.Errorf("transaction not found")
	}

	for _, inst := range result.Result.Transaction.Message.Instructions {
		if inst.ProgramId == solanaMemoProgramID {
			if s, ok := inst.Parsed.(string); ok && s != "" {
				return s, nil
			}
		}
	}

	return "", nil
}

func decryptMemo(memoBase64, agentToken string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(memoBase64)
	if err != nil {
		raw, err = base64.URLEncoding.DecodeString(memoBase64)
		if err != nil {
			return "", fmt.Errorf("invalid base64 memo: %v", err)
		}
	}

	if len(raw) < 12+16+1 {
		return "", fmt.Errorf("memo too short to be valid ciphertext")
	}

	nonce := raw[:12]
	ciphertext := raw[12:]

	keyHash := sha256.Sum256([]byte(agentToken))
	block, err := aes.NewCipher(keyHash[:])
	if err != nil {
		return "", fmt.Errorf("failed to create AES cipher: %v", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %v", err)
	}

	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %v", err)
	}

	return string(plaintext), nil
}

func parseMemoURLs(decrypted string) []string {
	var urls []string
	seen := map[string]struct{}{}
	for _, line := range strings.Split(decrypted, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		normalized, err := normalizeServerURL(line)
		if err != nil {
			log.Printf("[solana] invalid URL in memo: %q: %v", line, err)
			continue
		}
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		urls = append(urls, normalized)
	}
	return urls
}
