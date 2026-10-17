; Cold-cache SHA-256 validation using the native Windows CNG provider.
; Input: CngPath, CngExpectedSize. Output: CngResult or nonempty CngError.
; Open one provider and one 1 MiB buffer for a cold validation pass.
Var CngProvider
Var CngBuffer
Var CngDigest
Var CngPath
Var CngExpectedSize
Var CngResult
Var CngError
Var CngFile
Var CngHash
Var CngTotal

Function CngInit
  StrCpy $CngProvider 0
  StrCpy $CngBuffer 0
  StrCpy $CngDigest 0
  StrCpy $CngError "provider"
  System::Call 'bcrypt::BCryptOpenAlgorithmProvider(*p.r0, w "SHA256", p 0, i 0) i.r1'
  StrCmp $1 0 0 done
  StrCpy $CngProvider $0
  StrCpy $CngError "allocation"
  System::Alloc 1048576
  Pop $CngBuffer
  StrCmp $CngBuffer 0 done
  System::Alloc 32
  Pop $CngDigest
  StrCmp $CngDigest 0 done
  StrCpy $CngError ""
done:
FunctionEnd

Function CngFree
  StrCmp $CngDigest 0 +2
    System::Free $CngDigest
  StrCpy $CngDigest 0
  StrCmp $CngBuffer 0 +2
    System::Free $CngBuffer
  StrCpy $CngBuffer 0
  StrCmp $CngProvider 0 +2
    System::Call 'bcrypt::BCryptCloseAlgorithmProvider(p $CngProvider, i 0) i.r0'
  StrCpy $CngProvider 0
FunctionEnd

Function CngHashFile
  StrCpy $CngResult ""
  StrCpy $CngFile -1
  StrCpy $CngHash 0
  StrCpy $CngTotal 0
  StrCpy $CngError "open"
  ; FILE_SHARE_READ prevents concurrent writes/deletes while this handle lives.
  ; FILE_FLAG_SEQUENTIAL_SCAN is a cache hint, never a bypass of integrity checks.
  System::Call 'kernel32::CreateFileW(w "$CngPath", i 0x80000000, i 1, p 0, i 3, i 0x08000080, p 0) p.r0'
  StrCpy $CngFile $0
  StrCmp $CngFile -1 done
  StrCpy $CngError "size"
  System::Call 'kernel32::GetFileSizeEx(p $CngFile, *l.r1) i.r0'
  StrCmp $0 0 done
  StrCmp $1 $CngExpectedSize 0 done
  StrCpy $CngError "createhash"
  ; CNG owns the hash-object storage (Windows 7+), released by DestroyHash.
  System::Call 'bcrypt::BCryptCreateHash(p $CngProvider, *p.r0, p 0, i 0, p 0, i 0, i 0) i.r1'
  StrCmp $1 0 0 done
  StrCpy $CngHash $0
read:
  StrCpy $CngError "read"
  System::Call 'kernel32::ReadFile(p $CngFile, p $CngBuffer, i 1048576, *i.r1, p 0) i.r0'
  StrCmp $0 0 done
  StrCmp $1 0 finish
  IntOp $CngTotal $CngTotal + $1
  StrCpy $CngError "hashdata"
  System::Call 'bcrypt::BCryptHashData(p $CngHash, p $CngBuffer, i r1, i 0) i.r0'
  StrCmp $0 0 read done
finish:
  StrCpy $CngError "size"
  StrCmp $CngTotal $CngExpectedSize 0 done
  StrCpy $CngError "finishhash"
  System::Call 'bcrypt::BCryptFinishHash(p $CngHash, p $CngDigest, i 32, i 0) i.r0'
  StrCmp $0 0 0 done
  StrCpy $CngError "hex"
  StrCpy $2 65
  ; HEXRAW | NOCRLF: 64 hexadecimal characters and a terminating wide NUL.
  System::Call 'crypt32::CryptBinaryToStringW(p $CngDigest, i 32, i 0x4000000C, w .r3, *i r2) i.r0'
  StrCmp $0 0 done
  StrCpy $CngResult $3
  StrCpy $CngError ""
done:
  StrCmp $CngHash 0 +2
    System::Call 'bcrypt::BCryptDestroyHash(p $CngHash) i.r0'
  StrCmp $CngFile -1 +2
    System::Call 'kernel32::CloseHandle(p $CngFile) i.r0'
FunctionEnd
