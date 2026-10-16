// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Net.WebSockets;
using XiHan.PrintClient.Core.Server;

namespace XiHan.PrintClient.Core.Tests.Server;

public sealed class SessionRegistryTests
{
    private static WebSocketConnection Connection() => new(WebSocket.CreateFromStream(new MemoryStream(), new WebSocketCreationOptions { IsServer = true }), 1024);

    [Fact]
    public void ResumesOnlyTheSameOriginWithinTheWindow()
    {
        var time = new ManualTime();
        var registry = new SessionRegistry(TimeSpan.FromMinutes(10), time);
        var first = Connection();
        var (session, resumed) = registry.Open("https://a.example", null, first);
        Assert.False(resumed);

        registry.Detach(session, first);
        Assert.False(session.IsAttached);
        Assert.False(registry.Open("https://b.example", session.Token, Connection()).Resumed);

        time.Advance(TimeSpan.FromMinutes(9));
        var (again, resumedAgain) = registry.Open("https://a.example", session.Token, Connection());
        Assert.True(resumedAgain);
        Assert.Same(session, again);
        Assert.True(again.IsAttached);
    }

    [Fact]
    public void ExpiresDetachedSessionsAfterTheWindow()
    {
        var time = new ManualTime();
        var registry = new SessionRegistry(TimeSpan.FromMinutes(10), time);
        var expired = new List<ClientSession>();
        registry.Expired += expired.Add;
        var connection = Connection();
        var (session, _) = registry.Open("https://a.example", null, connection);
        registry.Detach(session, connection);

        time.Advance(TimeSpan.FromMinutes(11));
        registry.Sweep();

        Assert.Equal([session], expired);
        Assert.False(registry.Open("https://a.example", session.Token, Connection()).Resumed);
    }

    [Fact]
    public void DoesNotHandOverASessionThatIsStillAttached()
    {
        var registry = new SessionRegistry(TimeSpan.FromMinutes(10));
        var (session, _) = registry.Open("https://a.example", null, Connection());

        Assert.False(registry.Open("https://a.example", session.Token, Connection()).Resumed);
    }

    [Fact]
    public void CountsConnectionsPerOrigin()
    {
        var registry = new SessionRegistry(TimeSpan.FromMinutes(10));

        Assert.True(registry.TryAcquireConnection("https://a.example", 2));
        Assert.True(registry.TryAcquireConnection("https://a.example", 2));
        Assert.False(registry.TryAcquireConnection("https://a.example", 2));
        Assert.True(registry.TryAcquireConnection("https://b.example", 2));
        registry.ReleaseConnection("https://a.example");
        Assert.True(registry.TryAcquireConnection("https://a.example", 2));
    }

    private sealed class ManualTime : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 10, 16, 0, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan span) => _now += span;
    }
}
