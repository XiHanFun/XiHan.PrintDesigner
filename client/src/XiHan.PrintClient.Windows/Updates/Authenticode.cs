// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace XiHan.PrintClient.Windows.Updates;

/// <summary>
/// 签名校验的结论
/// </summary>
public enum SignatureState
{
    /// <summary>
    /// 签名可信，签名者是预期的发布者
    /// </summary>
    Trusted,

    /// <summary>
    /// 文件没有签名
    /// </summary>
    Unsigned,

    /// <summary>
    /// 有签名但不可信：证书链、时间戳或吊销检查没通过，或文件被改过
    /// </summary>
    Untrusted,

    /// <summary>
    /// 签名可信，但签名者不是预期的发布者
    /// </summary>
    WrongPublisher,
}

/// <summary>
/// 签名校验的结果
/// </summary>
/// <param name="State">结论</param>
/// <param name="Publisher">签名证书的 CN；没签名时为 null</param>
/// <param name="Organization">签名证书的 O；没有时为 null</param>
/// <param name="Code">WinVerifyTrust 的返回值</param>
public sealed record SignatureCheck(SignatureState State, string? Publisher, string? Organization, int Code);

/// <summary>
/// 经 WinVerifyTrust 校验文件内嵌的 Authenticode 签名（含整条链的吊销检查），再核对签名者的 CN 或 O 是否为预期的发布者
/// </summary>
public static unsafe partial class Authenticode
{
    private const uint UiNone = 2;
    private const uint RevokeWholeChain = 1;
    private const uint ChoiceFile = 1;
    private const uint StateActionVerify = 1;
    private const uint StateActionClose = 2;
    private const int NoSignature = unchecked((int)0x800B0100);

    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    /// <summary>
    /// 校验文件签名与签名者
    /// </summary>
    public static SignatureCheck Verify(string path, string expectedPublisher)
    {
        var code = WinVerify(path);
        if (code == NoSignature)
            return new SignatureCheck(SignatureState.Unsigned, null, null, code);
        var publisher = Publisher(path, out var organization);
        if (code != 0)
            return new SignatureCheck(SignatureState.Untrusted, publisher, organization, code);
        var matches = expectedPublisher.Length > 0
            && (string.Equals(publisher, expectedPublisher, StringComparison.OrdinalIgnoreCase) || string.Equals(organization, expectedPublisher, StringComparison.OrdinalIgnoreCase));
        return new SignatureCheck(matches ? SignatureState.Trusted : SignatureState.WrongPublisher, publisher, organization, code);
    }

    private static int WinVerify(string path)
    {
        fixed (char* filePath = path)
        {
            var fileInfo = new FileInfo { Size = (uint)sizeof(FileInfo), FilePath = filePath };
            var data = new TrustData
            {
                Size = (uint)sizeof(TrustData),
                UiChoice = UiNone,
                RevocationChecks = RevokeWholeChain,
                UnionChoice = ChoiceFile,
                File = &fileInfo,
                StateAction = StateActionVerify,
            };
            var action = GenericVerifyV2;
            var result = WinVerifyTrust(-1, &action, &data);
            data.StateAction = StateActionClose;
            WinVerifyTrust(-1, &action, &data);
            return result;
        }
    }

    private static string? Publisher(string path, out string? organization)
    {
        organization = null;
        try
        {
#pragma warning disable SYSLIB0057
            using var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
#pragma warning restore SYSLIB0057
            foreach (var part in certificate.SubjectName.EnumerateRelativeDistinguishedNames())
            {
                if (part.GetSingleElementType().Value == "2.5.4.10")
                    organization = part.GetSingleElementValue();
            }
            return certificate.GetNameInfo(X509NameType.SimpleName, forIssuer: false);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    [LibraryImport("wintrust.dll")]
    private static partial int WinVerifyTrust(nint window, Guid* action, TrustData* data);

    /// <summary>
    /// WINTRUST_FILE_INFO
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo
    {
        public uint Size;
        public char* FilePath;
        public nint File;
        public nint KnownSubject;
    }

    /// <summary>
    /// WINTRUST_DATA
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct TrustData
    {
        public uint Size;
        public nint PolicyCallbackData;
        public nint SipClientData;
        public uint UiChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public FileInfo* File;
        public uint StateAction;
        public nint StateData;
        public char* UrlReference;
        public uint ProviderFlags;
        public uint UiContext;
        public nint SignatureSettings;
    }
}
