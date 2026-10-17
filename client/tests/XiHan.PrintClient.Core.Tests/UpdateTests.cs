// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Net;
using System.Security.Cryptography;
using System.Text;
using XiHan.PrintClient.Core.Updates;

namespace XiHan.PrintClient.Core.Tests;

public sealed class UpdateTests : IDisposable
{
    private static readonly byte[] Installer = Encoding.ASCII.GetBytes("MZ fake installer bytes for the update test");
    private static readonly string InstallerHash = Convert.ToHexStringLower(SHA256.HashData(Installer));
    private static readonly Uri Gitee = new("https://gitee.example/update.json");
    private static readonly Uri GitHub = new("https://github.example/update.json");
    private static readonly Uri Asset = new("https://downloads.example/XiHanPrint-0.2.0-x64-setup.exe");
    private readonly string _directory = Directory.CreateTempSubdirectory("xihan-print-update-").FullName;
    private readonly FakeHandler _handler = new();

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    private static string Manifest(string version = "0.2.0", string arch = "x64", string? sha = null, long? size = null) => $$"""
        {
          // 由发版流水线生成
          "version": "{{version}}",
          "notes": "新增 PDF 导出",
          "assets": [{ "arch": "{{arch}}", "url": "{{Asset}}", "sha256": "{{sha ?? InstallerHash.ToUpperInvariant()}}", "size": {{size ?? Installer.Length}} }],
        }
        """;

    private UpdateChecker Checker(string current = "0.1.0") => new(new HttpClient(_handler), [Gitee, GitHub], Parse(current), "x64") { ManifestTimeout = TimeSpan.FromSeconds(2) };

    private static SemanticVersion Parse(string text)
    {
        Assert.True(SemanticVersion.TryParse(text, out var version));
        return version;
    }

    [Theory]
    [InlineData("0.2.0", "0.1.9")]
    [InlineData("1.0.0", "1.0.0-rc.1")]
    [InlineData("1.0.0-rc.2", "1.0.0-rc.1")]
    [InlineData("1.0.0-rc.10", "1.0.0-rc.9")]
    [InlineData("1.0.0-beta", "1.0.0-alpha.5")]
    [InlineData("1.0.0-alpha.1", "1.0.0-alpha")]
    [InlineData("1.0.0-alpha.beta", "1.0.0-alpha.1")]
    [InlineData("10.0.0", "9.99.99")]
    public void OrdersVersionsTheSemanticWay(string newer, string older)
    {
        Assert.True(Parse(newer).IsNewerThan(Parse(older)));
        Assert.False(Parse(older).IsNewerThan(Parse(newer)));
    }

    [Theory]
    [InlineData("1.2")]
    [InlineData("1.2.3.4")]
    [InlineData("v1.2.3")]
    [InlineData("1.2.3-")]
    [InlineData("1.2.3-a..b")]
    [InlineData("")]
    public void RejectsMalformedVersions(string text)
    {
        Assert.False(SemanticVersion.TryParse(text, out _));
    }

    [Fact]
    public void IgnoresBuildMetadata()
    {
        Assert.Equal("0.1.0", Parse("0.1.0+3f2a9c1").ToString());
        Assert.Equal(0, Parse("0.1.0+a").CompareTo(Parse("0.1.0+b")));
    }

    [Theory]
    [InlineData("""{"version":"0.2.0","assets":[{"arch":"x64","url":"http://insecure/a.exe","sha256":"aa","size":1}]}""")]
    [InlineData("""{"version":"0.2","assets":[]}""")]
    [InlineData("""{"version":"0.2.0"}""")]
    [InlineData("""[1]""")]
    [InlineData("""{ broken""")]
    public void RejectsManifestsThatAreIncomplete(string json)
    {
        Assert.Null(UpdateManifest.Parse(Encoding.UTF8.GetBytes(json), out var problem));
        Assert.NotNull(problem);
    }

    [Fact]
    public async Task OffersANewerVersionFromTheFirstSourceThatAnswers()
    {
        _handler.Responses[Gitee] = () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        _handler.Responses[GitHub] = () => Ok(Manifest());

        var result = await Checker().CheckAsync(UpdateTrigger.Manual, TestContext.Current.CancellationToken);

        Assert.Equal(GitHub, result.Source);
        Assert.NotNull(result.Offer);
        Assert.Equal("0.2.0", result.Offer.Manifest.Version.ToString());
        Assert.Equal(InstallerHash, result.Offer.Asset.Sha256);
        Assert.Equal([Gitee, GitHub], _handler.Requested);
    }

    [Fact]
    public async Task StopsAtTheFirstValidManifestEvenWhenItIsNotNewer()
    {
        _handler.Responses[Gitee] = () => Ok(Manifest("0.1.0"));

        var result = await Checker().CheckAsync(UpdateTrigger.Manual, TestContext.Current.CancellationToken);

        Assert.Equal((null, Gitee), (result.Offer, result.Source));
        Assert.Equal([Gitee], _handler.Requested);
    }

    [Fact]
    public async Task SkipsABrokenManifestAndOffersNothingWithoutAnAssetForThisArch()
    {
        _handler.Responses[Gitee] = () => Ok("""{ "version": "9.0.0" }""");
        _handler.Responses[GitHub] = () => Ok(Manifest(arch: "arm64"));

        var result = await Checker().CheckAsync(UpdateTrigger.Manual, TestContext.Current.CancellationToken);

        Assert.Equal((null, GitHub), (result.Offer, result.Source));
    }

    [Fact]
    public async Task ReportsNoSourceWhenNothingAnswers()
    {
        var result = await Checker().CheckAsync(UpdateTrigger.Manual, TestContext.Current.CancellationToken);

        Assert.Equal((null, null), (result.Offer, result.Source));
    }

    [Fact]
    public async Task DownloadsAndVerifiesTheInstaller()
    {
        _handler.Responses[Gitee] = () => Ok(Manifest());
        _handler.Responses[Asset] = () => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Installer) };
        var checker = Checker();
        var offer = (await checker.CheckAsync(UpdateTrigger.Manual, TestContext.Current.CancellationToken)).Offer!;
        var reported = new List<long>();

        var path = await checker.DownloadAsync(offer, _directory, new SyncProgress(reported.Add), TestContext.Current.CancellationToken);

        Assert.Equal(Path.Combine(_directory, "XiHanPrint-0.2.0-x64-setup.exe"), path);
        Assert.Equal(Installer, File.ReadAllBytes(path));
        Assert.Equal(Installer.Length, reported[^1]);
    }

    [Theory]
    [InlineData("0000000000000000000000000000000000000000000000000000000000000000", null, "SHA-256")]
    [InlineData(null, 5L, "大")]
    [InlineData(null, 500L, "大小不对")]
    public async Task DeletesInstallersThatDoNotMatchTheManifest(string? sha, long? size, string message)
    {
        _handler.Responses[Gitee] = () => Ok(Manifest(sha: sha, size: size));
        _handler.Responses[Asset] = () => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Installer) };
        var checker = Checker();
        var offer = (await checker.CheckAsync(UpdateTrigger.Manual, TestContext.Current.CancellationToken)).Offer!;

        var failure = await Assert.ThrowsAsync<UpdateFailure>(() => checker.DownloadAsync(offer, _directory, null, TestContext.Current.CancellationToken));

        Assert.Contains(message, failure.Message);
        Assert.Empty(Directory.GetFiles(_directory));
    }

    private static HttpResponseMessage Ok(string json) => new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private sealed class SyncProgress(Action<long> report) : IProgress<long>
    {
        public void Report(long value) => report(value);
    }

    private sealed class FakeHandler : HttpMessageHandler
    {
        public Dictionary<Uri, Func<HttpResponseMessage>> Responses { get; } = [];

        public List<Uri> Requested { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requested.Add(request.RequestUri!);
            if (Responses.TryGetValue(request.RequestUri!, out var respond))
                return Task.FromResult(respond());
            throw new HttpRequestException("连不上");
        }
    }
}
