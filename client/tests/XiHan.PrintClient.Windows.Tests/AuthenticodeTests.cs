// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Runtime.InteropServices;
using XiHan.PrintClient.Windows.Updates;

namespace XiHan.PrintClient.Windows.Tests;

public sealed class AuthenticodeTests
{
    /// <summary>
    /// .NET 运行时自带、内嵌微软签名的文件
    /// </summary>
    private static readonly string SignedByMicrosoft = Path.Combine(RuntimeEnvironment.GetRuntimeDirectory(), "coreclr.dll");

    [Fact]
    public void TrustsAValidSignatureFromTheExpectedPublisher()
    {
        var check = Authenticode.Verify(SignedByMicrosoft, "Microsoft Corporation");

        Assert.Equal(SignatureState.Trusted, check.State);
        Assert.Equal("Microsoft Corporation", check.Organization);
        Assert.NotNull(check.Publisher);
        Assert.Equal(0, check.Code);
        Assert.Equal(SignatureState.Trusted, Authenticode.Verify(SignedByMicrosoft, check.Publisher).State);
    }

    [Fact]
    public void RejectsAValidSignatureFromSomeoneElse()
    {
        Assert.Equal(SignatureState.WrongPublisher, Authenticode.Verify(SignedByMicrosoft, "XiHanFun").State);
        Assert.Equal(SignatureState.WrongPublisher, Authenticode.Verify(SignedByMicrosoft, string.Empty).State);
    }

    [Fact]
    public void RejectsUnsignedAndTamperedFiles()
    {
        var tampered = Path.Combine(Path.GetTempPath(), $"xihan-print-tampered-{Guid.NewGuid():N}.dll");
        try
        {
            Assert.Equal(SignatureState.Unsigned, Authenticode.Verify(Environment.ProcessPath!, "XiHanFun").State);

            var bytes = File.ReadAllBytes(SignedByMicrosoft);
            bytes[bytes.Length / 2] ^= 0xFF;
            File.WriteAllBytes(tampered, bytes);
            var check = Authenticode.Verify(tampered, "Microsoft Corporation");
            Assert.Equal(SignatureState.Untrusted, check.State);
            Assert.NotEqual(0, check.Code);
        }
        finally
        {
            File.Delete(tampered);
        }
    }
}
