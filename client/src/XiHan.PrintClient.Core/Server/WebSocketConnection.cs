// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.Buffers;
using System.Net.WebSockets;

namespace XiHan.PrintClient.Core.Server;

/// <summary>
/// 一条 WebSocket 连接：按条收文本消息并守住大小上限，发送串行化
/// </summary>
public sealed class WebSocketConnection : IAsyncDisposable
{
    private readonly WebSocket _socket;
    private readonly int _maxMessageBytes;
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    /// <summary>
    /// 包住一条已经升级好的 WebSocket
    /// </summary>
    public WebSocketConnection(WebSocket socket, int maxMessageBytes)
    {
        _socket = socket;
        _maxMessageBytes = maxMessageBytes;
    }

    /// <summary>
    /// 连接是否仍可收发
    /// </summary>
    public bool IsOpen => _socket.State == WebSocketState.Open;

    /// <summary>
    /// 收一条完整的文本消息；对方关闭时为 null。超过上限时以 1009 关闭，收到二进制消息时以 1003 关闭，都返回 null
    /// </summary>
    public async Task<byte[]?> ReceiveAsync(CancellationToken cancellationToken)
    {
        var buffer = new ArrayBufferWriter<byte>();
        while (true)
        {
            var memory = buffer.GetMemory(16 * 1024);
            var result = await _socket.ReceiveAsync(memory, cancellationToken).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                await CloseAsync(WebSocketCloseStatus.NormalClosure, string.Empty).ConfigureAwait(false);
                return null;
            }
            if (result.MessageType == WebSocketMessageType.Binary)
            {
                await CloseAsync(WebSocketCloseStatus.InvalidMessageType, "只收文本消息").ConfigureAwait(false);
                return null;
            }
            buffer.Advance(result.Count);
            if (buffer.WrittenCount > _maxMessageBytes)
            {
                await CloseAsync(WebSocketCloseStatus.MessageTooBig, "消息超过上限").ConfigureAwait(false);
                return null;
            }
            if (result.EndOfMessage)
                return buffer.WrittenSpan.ToArray();
        }
    }

    /// <summary>
    /// 发一条文本消息；连接已断开时返回 false
    /// </summary>
    public Task<bool> SendTextAsync(byte[] message, CancellationToken cancellationToken = default) => SendAsync(message, WebSocketMessageType.Text, cancellationToken);

    /// <summary>
    /// 发一条二进制消息；连接已断开时返回 false
    /// </summary>
    public Task<bool> SendBinaryAsync(byte[] message, CancellationToken cancellationToken = default) => SendAsync(message, WebSocketMessageType.Binary, cancellationToken);

    /// <summary>
    /// 以给定关闭码关闭连接；已关闭时什么都不做
    /// </summary>
    public async Task CloseAsync(WebSocketCloseStatus status, string reason)
    {
        await _sendLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await _socket.CloseOutputAsync(status, reason, CancellationToken.None).ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
        }
        finally
        {
            _sendLock.Release();
        }
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        _socket.Dispose();
        _sendLock.Dispose();
        return ValueTask.CompletedTask;
    }

    private async Task<bool> SendAsync(byte[] message, WebSocketMessageType type, CancellationToken cancellationToken)
    {
        await _sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_socket.State != WebSocketState.Open)
                return false;
            await _socket.SendAsync(message, type, true, cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (WebSocketException)
        {
            return false;
        }
        finally
        {
            _sendLock.Release();
        }
    }
}
